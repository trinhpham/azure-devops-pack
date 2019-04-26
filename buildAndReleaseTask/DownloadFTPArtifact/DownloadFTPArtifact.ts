"use strict";

import fs = require("fs");
import Client = require("ftp");
import path = require("path");
import shell = require("shelljs");
import url = require("url");
import tl = require("vsts-task-lib/task");

const ftpServerConst = "ftp-server";
const endpointUsername = "username";
const endpointPassword = "password";
const ftpDirConst = "ftp-directory";
const targetDirConst = "target-directory";

let ftpConfig: Client.Options = null;

async function downloadFile(
  itemPath: string,
  item: Client.ListingElement,
  targetDir: string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    console.log(`=============Start get: ${itemPath}`);
    const fileFTP = new Client();
    fileFTP.on("ready", () => {
      fileFTP.get(itemPath, (error, stream: NodeJS.ReadableStream) => {
        try {
          if (error) {
            console.error(
              `Unable to download '${itemPath}', error: ${error.message}`,
            );
            failTask(
              `Unable to download '${itemPath}', error: ${error.message}`,
            );
          } else {
            stream.pipe(fs.createWriteStream(path.join(targetDir, item.name)));
            console.log("Wrote file: " + path.join(targetDir, item.name));
          }
        } catch (e) {
          console.log("Error when writing file: " + itemPath);
          reject("Error when writing file: " + itemPath);
        } finally {
          console.log("=============End get: " + itemPath);
          fileFTP.end();
          fileFTP.destroy();
          resolve(null);
        }
      });
    });
    fileFTP.connect(ftpConfig);
  });
}

async function downloadFromFTP(
  ftp: Client,
  ftpDir: string,
  targetDir: string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    shell.mkdir("-p", targetDir);
    ftp.list(ftpDir, async (_, listing) => {
      try {
        if (listing) {
          for (const item of listing) {
            try {
              const itemPath = ftpDir + "/" + item.name;
              tl.debug("Processing: " + itemPath);
              if (item.type === "d") {
                shell.mkdir("-p", path.join(targetDir, item.name));
                await downloadFromFTP(
                  ftp,
                  itemPath,
                  path.join(targetDir, item.name),
                );
              } else if (item.type === "-") {
                await downloadFile(itemPath, item, targetDir);
              } else {
                console.log(
                  `Unsupported FTP file type '${item.type}' for: ${itemPath}`,
                );
              }
            } catch (err) {
              failTask(
                `Error happens while downloading ${item}: ${err.message}`,
              );
            }
          }
        }
      } finally {
        resolve(null);
      }
    });
  });
}

async function run() {
  await new Promise<void>((resolve, reject) => {
    try {
      tl.debug("Enter downloadFromFTP FTP Artifact");
      let host, port, user, pass, inDir, outDir: string, isSecured: boolean;
      if (process.argv.includes("HLV_DEV")) {
        // For debug only
        console.log("Entering debug mode");
        const debugInfo = require("./debug.json");
        ({ host, port, user, pass, inDir, outDir, isSecured } = debugInfo);
      } else {
        const endpointName = tl.getInput(ftpServerConst, true);
        tl.debug("endpointName: " + endpointName);
        const endpointUrl = tl.getEndpointUrl(endpointName, false);
        tl.debug("url: " + endpointUrl);
        if (!endpointUrl) {
          failTask("Invalid FTP Endpoint URL: " + endpointUrl);
          return;
        }
        const parsedUrl = url.parse(endpointUrl);
        host = parsedUrl.host;
        port = parsedUrl.port;
        if (!port || port <= 0) {
          port = "21";
        }

        isSecured = parsedUrl.protocol === "ftps";
        user = tl.getEndpointAuthorizationParameter(
          endpointName,
          endpointUsername,
          false,
        );
        pass = tl.getEndpointAuthorizationParameter(
          endpointName,
          endpointPassword,
          false,
        );
        outDir = tl.getInput(targetDirConst, true);

        inDir = tl.getInput(ftpDirConst, true);
        if (inDir.endsWith("/")) {
          // trim ending slash
          inDir = inDir.substring(0, inDir.lastIndexOf("/"));
        }
      }

      const ftpClient = new Client();

      let downloadSuccessful: boolean = false;

      ftpClient.on("greeting", (message: string) => {
        tl.debug("ftp client greeting");
        console.log("FTPConnected: " + message);
      });

      ftpClient.on("ready", async () => {
        tl.debug("ftp client ready");
        try {
          await downloadFromFTP(ftpClient, inDir, outDir);
          downloadSuccessful = true;
          tl.setResult(tl.TaskResult.Succeeded, "Download succeeded");
        } catch (err) {
          failTask(err);
          reject(err);
        } finally {
          console.log("DisconnectHost");
          ftpClient.end();
          ftpClient.destroy();
          resolve(null);
        }
      });

      ftpClient.on("close", (hadErr: boolean) => {
        console.log("Disconnected");
        tl.debug("ftp client close, hadErr:" + hadErr);
      });

      ftpClient.on("end", () => {
        tl.debug("ftp client end");
      });

      ftpClient.on("error", (err) => {
        tl.debug("ftp client error, err: " + err);
        if (!downloadSuccessful) {
          // once all files are successfully downloaded, a subsequent error should not fail the task
          failTask(err);
          reject(err);
        }
      });

      ftpConfig = {
        host,
        port: +port,
        user,
        password: pass,
        secure: isSecured,
      };
      ftpClient.connect(ftpConfig);
    } catch (err) {
      failTask(err.message);
    }
  });
}

function failTask(message: string): void {
  const fullMessage: string = `FTP download failed: "${message}".`;
  console.log(fullMessage);
  tl.setResult(tl.TaskResult.Failed, message);
}

run();
