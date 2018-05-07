'use strict';
import tl = require("vsts-task-lib/task");
import Client = require('ftp');
import url = require("url");
import fs = require("fs");
import shell = require("shelljs");
import Q = require('q');

const ftpServer = "ftp-server";
const endpointUsername = "username";
const endpointPassword = "password";
const ftpDir = "ftp-directory";
const targetDir = "target-directory";


let ftpConfig = null;

async function downloadFile(itemPath, item: Client.ListingElement, targetDir: string): Promise<void> {
    let fileDownloadDefer: Q.Deferred<void> = Q.defer<void>();
    console.log("=============Start get: " + itemPath);
    let fileFTP = new Client();
    fileFTP.on("ready", () => {
        fileFTP.get(itemPath, (error, stream: NodeJS.ReadableStream) => {
            try {
                if (error) {
                    console.error("Unable to download '%s', error: %s", itemPath, error.message);
                    tl.setResult(tl.TaskResult.Failed, error.message);
                } else {
                    stream.pipe(fs.createWriteStream(targetDir + '/' + item.name));
                    console.log("Wrote file: " + targetDir + '/' + item.name);
                }
            } catch (e) {
                console.log("Error when writing file: " + itemPath);
            } finally {
                console.log("=============End get: " + itemPath);
                fileFTP.end();
                fileFTP.destroy();
                fileDownloadDefer.resolve(null);
            }
        });
    });
    fileFTP.connect(ftpConfig);
    return fileDownloadDefer.promise;
}

async function downloadFromFTP(ftp: Client, ftpDir: string, targetDir: string): Promise<void> {
    let defer: Q.Deferred<void> = Q.defer<void>();
    shell.mkdir("-p", targetDir);
    ftp.list(
        ftpDir,
        async (_, listing) => {
            try {
                if (listing) {
                    for (let i = 0; i < listing.length; i++) {
                        let item = listing[i];
                        try {
                            let itemPath = ftpDir + '/' + item.name;
                            tl.debug("Processing: " + itemPath);
                            if (item.type == 'd') {
                                shell.mkdir("-p", targetDir + '/' + item.name);
                                await downloadFromFTP(ftp, itemPath, targetDir + '/' + item.name);
                            } else if (item.type == '-') {
                                await downloadFile(itemPath, item, targetDir);
                            } else {
                                console.log("Unsupported FTP file type '%s' for: %s", item.type, itemPath);
                            }
                        } catch (err) {
                            tl.setResult(tl.TaskResult.Failed, "Error happens: " + err.message);
                            return;
                        }
                    }
                }
            } finally {
                defer.resolve(null);
            }
        }
    );
    return defer.promise;
}

async function run() {
    try {
        tl.debug("Enter downloadFromFTP FTP Artifact");
        let host, port, user, pass, inDir, outDir: string, isSecured: boolean;
        if (tl.getInput("HLV_DEV") != null) {
            host = "192.168.167.107";
            port = "21";
            user = "trinh.pham";
            pass = "myloveisT74643";
            isSecured = false;
            inDir = "Build/artifacts/EPG/TADocker/8.3.4.5046/ta-automation";
            outDir = "F:";
        } else {
            let endpointName = tl.getInput(ftpServer);
            tl.debug("endpointName: " + endpointName);
            let endpointUrl = tl.getEndpointUrl(endpointName, false);
            tl.debug("url: " + endpointUrl);
            if (endpointUrl == null) {
                tl.setResult(tl.TaskResult.Failed, "Invalid FTP Endpoint URL: " + endpointUrl);
                return;
            }
            let parsedUrl = url.parse(endpointUrl);
            host = parsedUrl.host;
            port = parsedUrl.port;
            if (port == null || port == "" || port <= 0) {
                port = "21";
            }

            isSecured = parsedUrl.protocol == "ftps";
            user = tl.getEndpointAuthorizationParameter(endpointName, endpointUsername, false);
            pass = tl.getEndpointAuthorizationParameter(endpointName, endpointPassword, false);
            outDir = tl.getInput(targetDir);
            if (outDir != null && !outDir.endsWith("/")) {
                outDir += "/";
            }

            inDir = tl.getInput(ftpDir);
            if (inDir != null && inDir.endsWith("/")) {
                inDir = inDir.substring(0, inDir.lastIndexOf("/"));
            }
        }

        let ftpClient: any = new Client();

        let downloadSuccessful: boolean = false;

        ftpClient.on('greeting', (message: string) => {
            tl.debug('ftp client greeting');
            console.log('FTPConnected: ' + message);
        });

        ftpClient.on('ready', async () => {
            tl.debug('ftp client ready');
            try {
                await downloadFromFTP(ftpClient, inDir, outDir);
                downloadSuccessful = true;
                tl.setResult(tl.TaskResult.Succeeded, "Download succeeded");
            } catch (err) {
                failTask(err);
            } finally {
                console.log('DisconnectHost');
                ftpClient.end();
                ftpClient.destroy();
            }
        });

        ftpClient.on('close', (hadErr: boolean) => {
            console.log('Disconnected');
            tl.debug('ftp client close, hadErr:' + hadErr);
        });

        ftpClient.on('end', () => {
            tl.debug('ftp client end');
        });

        ftpClient.on('error', (err) => {
            tl.debug('ftp client error, err: ' + err);
            if (!downloadSuccessful) {
                // once all files are successfully downloaded, a subsequent error should not fail the task
                failTask(err);
            }
        });

        let verboseSnippet: string[] = [];
        let debugLogger: any = function (message) {
            verboseSnippet.push(message);
            if (verboseSnippet.length >= 5) {
                verboseSnippet.shift();
            }
            tl.debug(message);
        };

        function failTask(message: string): void {
            let fullMessage: string = `FTP download failed: "${message}". FTP log: "${verboseSnippet}".`;
            console.log(fullMessage);
            tl.setResult(tl.TaskResult.Failed, message);
        }

        ftpConfig = {
            'host': host,
            'port': +port,
            'user': user,
            'password': pass,
            'secure': isSecured,
            'debug': debugLogger
        };
        ftpClient.connect(ftpConfig);
        return;
    } catch (err) {
        tl.setResult(tl.TaskResult.Failed, 'DownloadFTPArtifactFAILED: ' + err.message);
    }
}

run();