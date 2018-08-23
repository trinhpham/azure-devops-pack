'use strict';

import tl = require("vsts-task-lib/task");
import url = require("url");
import fs = require("fs");
import Q = require('q');
import process = require('process');

async function run() {
    try {
        var resultFile, testConfiguration, testSuite, testPlan;

        if (process.argv.includes("hlv-debug")){
            tl.debug("Enter debug mode");
        } else {
            resultFile = tl.getInput("resultFile");
            testConfiguration = tl.getInput("testConfiguration");
            testSuite = tl.getInput("testSuite");
            testPlan = tl.getInput("testPlan");
        }
        tl.debug("Enter PublishTestPlanResults");
        tl.debug("")
    } catch (err) {
        tl.setResult(tl.TaskResult.Failed, 'PublishTestPlanResults FAILED ' + err.message);
    }
}

run();