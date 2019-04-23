"use strict";

import fs = require("fs");
import path = require("path");
import Q = require("q");
import shell = require("shelljs");
import simplegit from "simple-git/promise";
import tl = require("vsts-task-lib/task");

let userName, userEmail, gitDirectory, remoteUrl, gitCommand, remoteBranch, excludeFile;
const git = simplegit();

let REMOTE_NAME = "toSync";
async function run() {
    try {
        log("Enter Git Command");
        if (process.argv.includes("HLV_DEV")) {
            // For debug only
            console.log("Entering debug mode");
            const debugInfo = require("./debug.json");
            ({userName, userEmail, gitDirectory, remoteUrl, gitCommand, remoteBranch, excludeFile} = debugInfo);
        } else {
            log("Loading params");
            userName = tl.getInput("userName", true);
            userEmail = tl.getInput("userEmail", true);
            gitDirectory = tl.getInput("gitDirectory", true);
            remoteUrl = tl.getInput("remoteUrl", true);
            gitCommand = tl.getInput("gitCommand", true);
            remoteBranch = tl.getInput("remoteBranch", true);
            excludeFile = tl.getInput("excludeFile", false);
        }

        // add local git config like username and email
        await git.addConfig("user.email", userEmail);
        await git.addConfig("user.name", userName);

        // Change working dir
        await git.cwd(gitDirectory);

        // Init if this is not a git directory
        if (await git.checkIsRepo()) {
            await git.init();
        }

        // Add remote
        const curRemote = (await git.getRemotes(true)).filter((r) => r.refs.fetch === remoteUrl);
        if (curRemote.length === 0) {
            await git.addRemote(REMOTE_NAME, remoteUrl);
        } else {
            REMOTE_NAME = curRemote[0].name;
        }
        await git.fetch(REMOTE_NAME);

        switch (gitCommand) {
            case "sync":
                await syncToRemote();
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

async function syncToRemote() {
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
