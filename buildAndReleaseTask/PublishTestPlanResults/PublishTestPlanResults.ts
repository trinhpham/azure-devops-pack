"use strict";

import console = require("console");
import fs = require("fs");
import process = require("process");
import Q = require("q");
import url = require("url");
import tl = require("vsts-task-lib/task");
import sxml = require("sxml");
import path = require("path");

import XML = sxml.XML;
import XMLList = sxml.XMLList;

import { IRequestHandler } from "vso-node-api/interfaces/common/VsoBaseInterfaces";
import { TestPlan, TestPoint, TestCaseResult, TestRun } from "vso-node-api/interfaces/TestInterfaces";
import { RunCreateModel, RunUpdateModel } from "vso-node-api/interfaces/TestInterfaces";
import { getHandlerFromToken, getBasicHandler } from "vso-node-api/WebApi";
import { TestApi } from "vso-node-api/TestApi";

let HL_DEBUG = false;
const DEFAULT_RUN_NAME = "Automated result publishing test";

function hlLog(message, force?: boolean) {
    if (force || HL_DEBUG) {
        console.log(message);
    }
    tl.debug(message);
}

function parseInput() {
    let resultFile: string;
    let htmlFile: string;
    let testConfiguration: string;
    let testSuite: string;
    let testPlan: string;
    let endpointUrl: string;
    let credentialHandler: IRequestHandler;
    let teamProjId: string;
    let testRunName: string;

    if (process.argv.indexOf("hl-debug") > -1) {
        HL_DEBUG = true;
        htmlFile = "helium-report.html";
        resultFile = "xunit.xml";
        testConfiguration = "1";
        testSuite = "3";
        testPlan = "1";
        teamProjId = "Helium";
        endpointUrl = "http://192.168.171.84:8080/tfs/DefaultCollection";
        credentialHandler = getBasicHandler("test", "admin");
        testRunName = DEFAULT_RUN_NAME;
    } else {
        htmlFile = tl.getInput("htmlFile");
        resultFile = tl.getInput("resultFile");
        testConfiguration = tl.getInput("testConfiguration", false);
        testSuite = tl.getInput("testSuite");
        testPlan = tl.getInput("testPlan");
        endpointUrl = tl.getVariable("System.TeamFoundationCollectionUri");
        teamProjId = tl.getVariable("System.TeamProjectId");
        const auth = tl.getEndpointAuthorization("SYSTEMVSSCONNECTION", false);
        if (auth) {
            /* tslint:disable:no-string-literal */
            credentialHandler = getHandlerFromToken(auth.parameters["AccessToken"]);
            /* tslint:enable:no-string-literal */
        } else {
            throw new Error("Cannot getEndpointAuthorization");
        }
        testRunName = tl.getInput("runName", false);
    }
    return {
        credentialHandler,
        endpointUrl,
        teamProjId,
        testPlan,
        testSuite,
        testConfiguration,
        testRunName,
        resultFile,
        htmlFile,
    };
}

function fileExist(filePath: string): boolean {
    try {
        const fileStats: fs.Stats = fs.statSync(filePath);
        return fileStats && fileStats.isFile();
    } catch (err) {
        return false;
    }
}

function parseResult(filePath: string): { [id: string]: XML } {
    if (!fileExist(filePath)) {
        hlLog("CWD: " + path.resolve("./"));
        throw new Error(`Cannot acccess to file: ${filePath}`);
    }
    // CREATE AN XML OBJECT BY PARSING CHARACTERS
    const xUnitString: string = fs.readFileSync(filePath, "utf8");
    const xml: XML = new XML(xUnitString);
    const testCases: XMLList = xml.get("testcase");
    const tcResults: { [id: string]: XML } = {};
    for (let i = 0; i < testCases.size(); i++) {
        const tcResult = testCases.at(i);
        let mapFound: boolean = false;
        if (tcResult.has("properties")) {
            const listTcProps = tcResult.get("properties").at(0).get("property");
            if (listTcProps.size() > 0) {
                for (let j = 0; j < listTcProps.size(); j++) {
                    if (listTcProps.at(j).getProperty("name") === "id") {
                        const tcId = listTcProps.at(j).getProperty("value");
                        if (tcId in tcResults) {
                            // TODO: Handle duplicate result of the same test case ID
                            hlLog(`Found duplicated ID[${tcId}], the last result is uploaded`, true);
                        }
                        tcResults[tcId] = tcResult;
                        mapFound = true;
                        break;
                    }
                }
            }
        }
        if (!mapFound) {
            hlLog("Unable to load the mapping infor of: " + tcResult.toString(), true);
        }
    }
    return tcResults;
}

async function run() {
    try {
        const input = parseInput();
        const credentialHandler = input.credentialHandler;
        const endpointUrl = input.endpointUrl;
        const teamProjId = input.teamProjId;
        const testPlan = input.testPlan;
        const testSuite = input.testSuite;
        const testConfiguration = input.testConfiguration;
        let testRunName = input.testRunName;
        const resultFile = input.resultFile;
        const htmlFile = input.htmlFile;

        // Validate input
        if (!testRunName) {
            testRunName = DEFAULT_RUN_NAME;
        }
        const tcResults: {[id: string]: XML} = parseResult(resultFile);

        // Validate testplan
        const testApi: TestApi = new TestApi(endpointUrl, [credentialHandler]);
        const plan: TestPlan = await testApi.getPlanById(teamProjId, +testPlan);
        if (!plan) {
            throw new Error(`Invalid test plan: ${testPlan}`);
        }

        // TODO: Validate testsuite, configuration,...

        hlLog(`Enter PublishTestPlanResults ==========>
            htmlFile: ${htmlFile}
            resultFile: ${resultFile}
            testConfiguration: ${testConfiguration}
            testSuite: ${testSuite}
            testPlan: ${testPlan}
            teamproj: ${teamProjId}`);

        // Create a test run with parsed test case results
        const points: TestPoint[] = await testApi.getPoints(
            teamProjId, +testPlan, +testSuite, undefined, testConfiguration);
        const listPointIds: number[] = [];
        points.forEach((p) => {
            if (`${p.testCase.id}` in tcResults) {
                listPointIds.push(p.id);
            } else {
                hlLog(`Test point with [tcId: ${p.testCase.id}]`
                    + ` and [Conf: ${p.configuration.name}] is not in result`);
            }
        });
        const runCreateModel: RunCreateModel = {
            automated: true,
            configurationIds: [+testConfiguration],
            name: testRunName,
            plan: {id: plan.id},
            pointIds: listPointIds,
            state: "InProgress",
        } as any;
        const testRun: TestRun = await testApi.createTestRun(runCreateModel, teamProjId);
        hlLog(`Created run[${testRun.id}] with url: ${testRun.webAccessUrl}`, true);

        // Update all results of the test run
        const listResults: TestCaseResult[] = await testApi.getTestResults(teamProjId, testRun.id);

        // TODO: Validate orphaned results
        for (const id in tcResults) {
            if (!listResults.find((tc) => {
                return `${tc.testCase.id}` === id;
            })) {
                hlLog("The following test result is not belong to the selected test suite\n"
                    + tcResults[id].toString(), true);
            }
        }

        const updatedResults: TestCaseResult[] = listResults.map((result) => {
            const tcResult = tcResults[`${result.testCase.id}`];

            // Upload testcase attachment
            testApi.createTestResultAttachment({
                attachmentType: "GeneralAttachment",
                comment: "The test case result attachment",
                fileName: `${result.testCase.id}_xunit.xml`,
                stream: Buffer.from(tcResult.toString()).toString("base64"),
            }, teamProjId, testRun.id, result.id);

            // Parse comment message for test case result
            const resultStatus = !tcResult.has("failure");
            let resultMsg = tcResult.has("system-out") ? tcResult.get("system-out").at(0).getValue() : "";
            if (!resultStatus) {
                resultMsg += "\nERROR:\n" + tcResult.get("failure").at(0).getValue();
            }
            const testCaseResult = {
                TestResult: { id: result.id },
                comment: resultMsg,
                id: result.id,
                outcome: resultStatus ? "Passed" : "Failed",
                state: "Completed",
            } as any;
            return testCaseResult;
        });
        await testApi.updateTestResults(updatedResults, teamProjId, testRun.id);

        // Attach test run result
        if (fileExist(htmlFile)) {
            testApi.createTestRunAttachment({
                    attachmentType: "GeneralAttachment",
                    comment: "This is the testrun attachment",
                    fileName: path.basename(htmlFile),
                    stream: Buffer.from(fs.readFileSync(htmlFile, "utf8")).toString("base64"),
            }, teamProjId, testRun.id);
        }

        // Complete the run
        testApi.updateTestRun({
            state: "Completed",
        } as RunUpdateModel, teamProjId, testRun.id);
    } catch (err) {
        const msg = "PublishTestPlanResults FAILED " + err.message;
        hlLog(msg);
        tl.setResult(tl.TaskResult.Failed, msg);
    }
}

run();
