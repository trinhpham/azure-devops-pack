"use strict";

import fs = require("fs");
import path = require("path");
import Q = require("q");
import shell = require("shelljs");
import simplegit from "simple-git/promise";
import tl = require("vsts-task-lib/task");

let userName, userEmail, gitDirectory, remoteUrl, gitCommand, remoteBranch;
const git = simplegit();

let REMOTE_NAME = "toSync";
async function run() {
    try {
        log("Enter Git Command");
        if (process.argv.includes("HLV_DEV")) {
            // For debug only
            console.log("Entering debug mode");
            const debugInfo = require("./debug.json");
            ({userName, userEmail, gitDirectory, remoteUrl, gitCommand, remoteBranch} = debugInfo);
        } else {
            log("Loading params");
            // tl.getInput()
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
    const hasRemote = `remotes/${REMOTE_NAME}/${remoteBranch}` in curBranches.branches;
    if (hasRemote) {
        const pullResult = await git.pull(REMOTE_NAME, remoteBranch, {"--rebase": "true"});
        log("Pull result: " + JSON.stringify(pullResult));
    }

    // Push to remote
    const pushResult = await git.push(REMOTE_NAME, remoteBranch);
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
