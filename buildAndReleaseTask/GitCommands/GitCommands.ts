"use strict";

import fs = require("fs");
import path = require("path");
import Q = require("q");
import shell = require("shelljs");
import simplegit from "simple-git/promise";
import tl = require("vsts-task-lib/task");

async function run() {
    let userName, userEmail, gitDirectory, remoteUrl, gitCommand, remoteBranch, excludeFile;
    let REMOTE_NAME = "toSync";

    try {
        log("Enter Git Command");
        if (process.argv.includes("HLV_DEV")) {
            // For debug only
            console.log("Entering debug mode");
            const debugInfo = require("./debug.json");
            ({userName, userEmail, gitDirectory, remoteUrl, gitCommand, remoteBranch, excludeFile} = debugInfo);
        } else {
            log("Loading params");
            userName = tl.getInput("userName");
            userEmail = tl.getInput("userEmail");
            gitDirectory = tl.getInput("gitDirectory", true);
            remoteUrl = tl.getInput("remoteUrl", true);
            gitCommand = tl.getInput("gitCommand", true);
            remoteBranch = tl.getInput("remoteBranch", true);
            excludeFile = tl.getInput("excludeFile", false);
        }

        log("Begin task");

        // Open working dir
        const git = simplegit(gitDirectory);
        log(`Open directory ${gitDirectory}`);

        // add local git config like username and email
        if (userEmail) { await git.addConfig("user.email", userEmail); }
        if (userName) { await git.addConfig("user.name", userName); }

        // Init if this is not a git directory
        log(`Check if current dir is a Git Repo`);
        if (! await git.checkIsRepo()) {
            log("Current dir is not a Git repo => initialize it");
            await git.init();
        }

        // Add remote
        const curRemote = (await git.getRemotes(true)).filter((r) => r.refs.fetch === remoteUrl);
        if (curRemote.length === 0) {
            log(`Remote '${REMOTE_NAME}' not found. Add it to current repo`);
            await git.addRemote(REMOTE_NAME, remoteUrl);
        } else {
            REMOTE_NAME = curRemote[0].name;
            log(`Found remote '${JSON.stringify(curRemote[0])}'`);
        }

        const fetchResult = await git.fetch(REMOTE_NAME, remoteBranch);
        log(`Fetch from new remote: ${JSON.stringify(fetchResult)}`);

        switch (gitCommand) {
            case "sync":
                await syncToRemote(git, REMOTE_NAME, remoteBranch);
                break;
            case "commit":
            default:
                log(`Invalid command: ${gitCommand}`);
                break;
        }
    } catch (err) {
        failTask(err.message);
    }
}

async function syncToRemote(git: simplegit.SimpleGit, REMOTE_NAME: string, remoteBranch: string) {
    // Rebase current local to remote Branch
    const curBranches = await git.branch(["-avv"]);
    const remoteExists = `remotes/${REMOTE_NAME}/${remoteBranch}` in curBranches.branches;
    if (remoteExists) {
        log(`Remote branch ${remoteBranch} existed`);
        const curDiff = await git.log({from: curBranches.current, to: `${REMOTE_NAME}/${remoteBranch}`});
        if (curDiff.total > 0 ) {
            const pullResult = await git.pull(REMOTE_NAME, remoteBranch, {"--rebase": "true"});
            log("Pull result: " + JSON.stringify(pullResult));
        }
    }

    // Push to remote
    const pushResult = await git.push(REMOTE_NAME, `${curBranches.current}:${remoteBranch}`);
    log("Push result: " + JSON.stringify(pushResult));
}

function log(msg: string) {
    tl.debug(msg);
    console.log(msg);
}
function failTask(message: string): void {
    const fullMessage: string = `Task was failed: "${message}".`;
    log(fullMessage);
    tl.setResult(tl.TaskResult.Failed, message);
}

run();
