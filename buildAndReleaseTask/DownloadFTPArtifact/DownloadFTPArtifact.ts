'use strict';
import tl = require("vsts-task-lib/task");
import * as Client from 'ftp';
import * as url from 'url';
import path = require('path');
import ftputils = require('./ftputils');

const ftpServer = "ftp-server";
const endpointUsername = "username";
const endpointPassword = "password";
const ftpDir = "ftp-directory";
const targetDir = "target-directory"

async function run() {
    try {
        tl.debug("Enter downloadFromFTP FTP Artifact");
        let host, port, user, pass, inDir, outDir: string, isSecured: boolean;
        if (tl.getInput("HLV_DEV") != null){
            host = "192.168.167.107";
            port = "21";
            user = "trinh.pham";
            pass = "myloveisT74643";
            isSecured = false;
            inDir = "Build/artifacts/EPG/TADocker/8.3.4.5046/ta-automation";
            outDir = "F:"
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
            if (outDir != null && !outDir.endsWith("/")){
                outDir += "/";
            }

            inDir = tl.getInput(ftpDir);
            if (inDir != null && inDir.endsWith("/")){
                inDir = inDir.substring(0, inDir.lastIndexOf("/"));
            }
        }
        tl.setResourcePath(path.join( __dirname, 'task.json'));

        let ftpOptions: ftputils.FtpOptions = ftputils.getFtpOptions();
        if (!ftpOptions.serverEndpointUrl.protocol) {
            tl.setResult(tl.TaskResult.Failed, tl.loc('FTPNoProtocolSpecified'));
        }
        if (!ftpOptions.serverEndpointUrl.hostname) {
            tl.setResult(tl.TaskResult.Failed, tl.loc('FTPNoHostSpecified'));
        }

        let ftpClient: any = new Client();
        let ftpHelper: ftputils.FtpHelper = new ftputils.FtpHelper(ftpOptions, ftpClient);

        let files: string[] = ftputils.findFiles(ftpOptions);
        tl.debug('number of files to upload: ' + files.length);
        tl.debug('files to upload: ' + JSON.stringify(files));

        let uploadSuccessful: boolean = false;

        ftpClient.on('greeting', (message: string) => {
            tl.debug('ftp client greeting');
            console.log(tl.loc('FTPConnected', message));
        });

        ftpClient.on('ready', async () => {
            tl.debug('ftp client ready');
            try {
                if (ftpOptions.clean) {
                    console.log(tl.loc('CleanRemoteDir', ftpOptions.remotePath));
                    await ftpHelper.cleanRemote(ftpOptions.remotePath);
                } else if (ftpOptions.cleanContents) {
                    console.log(tl.loc('CleanRemoteDirContents', ftpOptions.remotePath));
                    await ftpHelper.cleanRemoteContents(ftpOptions.remotePath);
                }

                console.log(tl.loc('UploadRemoteDir', ftpOptions.remotePath));
                await ftpHelper.uploadFiles(files);
                uploadSuccessful = true;
                console.log(tl.loc('UploadSucceedMsg', ftpHelper.progressTracking.getSuccessStatusMessage()));

                tl.setResult(tl.TaskResult.Succeeded, tl.loc('UploadSucceedRes'));
            } catch (err) {
                failTask(err);
            } finally {
                console.log(tl.loc('DisconnectHost', ftpOptions.serverEndpointUrl.host));
                ftpClient.end();
                ftpClient.destroy();
            }
        });

        ftpClient.on('close', (hadErr: boolean) => {
            console.log(tl.loc('Disconnected'));
            tl.debug('ftp client close, hadErr:' + hadErr);
        });

        ftpClient.on('end', () => {
            tl.debug('ftp client end');
        })

        ftpClient.on('error', (err) => {
            tl.debug('ftp client error, err: ' + err);
            if (!uploadSuccessful) {
                // once all files are successfully uploaded, a subsequent error should not fail the task
                failTask(err);
            }
        })

        let verboseSnippet: string[] = [];
        let debugLogger:any = function(message) {
            verboseSnippet.push(message);
            if (verboseSnippet.length >= 5) {
                verboseSnippet.shift();
            }
            tl.debug(message);
        };
        function failTask(message: string): void {
            let fullMessage: string = `FTP upload failed: "${message}". FTP log: "${verboseSnippet}".`;
            if (ftpHelper.progressTracking) {
                fullMessage += ftpHelper.progressTracking.getFailureStatusMessage();
            }
            console.log(fullMessage);
            tl.setResult(tl.TaskResult.Failed, message);
        }

        let secure: boolean = ftpOptions.serverEndpointUrl.protocol.toLowerCase() == 'ftps:' ? true : false;
        tl.debug('secure ftp=' + secure);

        let secureOptions: any = { 'rejectUnauthorized': !ftpOptions.trustSSL };

        let hostName: string = ftpOptions.serverEndpointUrl.hostname;
        port = ftpOptions.serverEndpointUrl.port;
        if (!port) { // port not explicitly specifed, use default
            port = '21';
            tl.debug('port not specifided, using default: ' + port);
        }

        console.log(tl.loc('ConnectPort', hostName, port));
        ftpClient.connect({ 'host': hostName, 'port': port, 'user': ftpOptions.username, 'password': ftpOptions.password, 'secure': secure, 'secureOptions': secureOptions, 'debug': debugLogger });
        return;
    } catch (err) {
        tl.setResult(tl.TaskResult.Failed, 'DownloadFTPArtifactFAILED: ' + err.message);
    }
}

run();