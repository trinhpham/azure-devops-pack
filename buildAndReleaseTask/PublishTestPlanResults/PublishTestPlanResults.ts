'use strict';
import tl = require("vsts-task-lib/task");
import url = require("url");
import fs = require("fs");
import shell = require("shelljs");
import Q = require('q');

const ftpServer = "ftp-server";
const endpointUsername = "username";
const endpointPassword = "password";
const ftpDir = "ftp-directory";
const targetDir = "target-directory";

async function run() {
    try {
        tl.debug("Enter PublishTestPlanResults");
        
    } catch (err) {
        tl.setResult(tl.TaskResult.Failed, 'PublishTestPlanResults FAILED ' + err.message);
    }
}

run();