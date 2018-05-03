"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const tl = require("vsts-task-lib/task");
const Q = require("q");
const path = require("path");
const url = require("url");
class FtpOptions {
}
exports.FtpOptions = FtpOptions;
class FtpHelper {
    constructor(ftpOptions, ftpClient) {
        this.ftpOptions = null;
        this.ftpClient = null;
        this.progressTracking = null;
        this.ftpOptions = ftpOptions;
        this.ftpClient = ftpClient;
    }
    createRemoteDirectory(remoteDirectory) {
        let defer = Q.defer();
        tl.debug('creating remote directory: ' + remoteDirectory);
        this.ftpClient.mkdir(remoteDirectory, true, function (err) {
            if (err) {
                defer.reject('Unable to create remote directory: ' + remoteDirectory + ' due to error: ' + err);
            }
            else {
                defer.resolve(null);
            }
        });
        return defer.promise;
    }
    uploadFile(file, remoteFile) {
        let defer = Q.defer();
        tl.debug('uploading file: ' + file + ' remote: ' + remoteFile);
        this.ftpClient.put(file, remoteFile, function (err) {
            if (err) {
                defer.reject('upload failed: ' + remoteFile + ' due to error: ' + err);
            }
            else {
                defer.resolve(null);
            }
        });
        return defer.promise;
    }
    remoteExists(remoteFile) {
        let defer = Q.defer();
        tl.debug('checking if remote exists: ' + remoteFile);
        let remoteDirname = path.normalize(path.dirname(remoteFile));
        let remoteBasename = path.basename(remoteFile);
        this.ftpClient.list(remoteDirname, function (err, list) {
            if (err) {
                //err.code == 550  is the standard not found error
                //but just resolve false for all errors
                defer.resolve(false);
            }
            else {
                for (let remote of list) {
                    if (remote.name == remoteBasename) {
                        defer.resolve(true);
                        return;
                    }
                }
                defer.resolve(false);
            }
        });
        return defer.promise;
    }
    rmdir(remotePath) {
        let defer = Q.defer();
        tl.debug('removing remote directory: ' + remotePath);
        this.ftpClient.rmdir(remotePath, true, function (err) {
            if (err) {
                defer.reject('Unable to remove remote folder: ' + remotePath + ' error: ' + err);
            }
            else {
                defer.resolve(null);
            }
        });
        return defer.promise;
    }
    remoteDelete(remotePath) {
        let defer = Q.defer();
        tl.debug('removing remote content: ' + remotePath);
        this.ftpClient.delete(remotePath, function (err) {
            if (err) {
                defer.reject('Unable to remove remote content: ' + remotePath + ' error: ' + err);
            }
            else {
                defer.resolve(null);
            }
        });
        return defer.promise;
    }
    cleanRemote(remotePath) {
        return __awaiter(this, void 0, void 0, function* () {
            tl.debug('cleaning remote directory: ' + remotePath);
            if (yield this.remoteExists(remotePath)) {
                yield this.rmdir(remotePath);
            }
        });
    }
    cleanRemoteContents(remotePath) {
        return __awaiter(this, void 0, void 0, function* () {
            tl.debug('cleaning remote directory contents: ' + remotePath);
            let that = this;
            let defer = Q.defer();
            this.ftpClient.list(path.normalize(remotePath), function (err, list) {
                return __awaiter(this, void 0, void 0, function* () {
                    try {
                        if (!err) {
                            for (let remote of list) {
                                let item = path.join(remotePath, remote.name);
                                if (remote.type === 'd') { // directories
                                    yield that.rmdir(item);
                                }
                                else {
                                    yield that.remoteDelete(item);
                                }
                            }
                        }
                        defer.resolve(null);
                    }
                    catch (err) {
                        defer.reject('Error cleaning remote path: ' + err);
                    }
                });
            });
            return defer.promise;
        });
    }
    uploadFiles(files) {
        let thisHelper = this;
        thisHelper.progressTracking = new ProgressTracking(thisHelper.ftpOptions, files.length + 1); // add one extra for the root directory
        tl.debug('uploading files');
        let defer = Q.defer();
        let outerPromises = []; // these run first, and their then clauses add more promises to innerPromises
        let innerPromises = [];
        outerPromises.push(this.createRemoteDirectory(thisHelper.ftpOptions.remotePath).then(() => {
            thisHelper.progressTracking.directoryProcessed(thisHelper.ftpOptions.remotePath);
        })); // ensure root remote location exists
        files.forEach((file) => {
            tl.debug('file: ' + file);
            let remoteFile = thisHelper.ftpOptions.preservePaths ?
                path.join(thisHelper.ftpOptions.remotePath, file.substring(thisHelper.ftpOptions.rootFolder.length)) :
                path.join(thisHelper.ftpOptions.remotePath, path.basename(file));
            remoteFile = remoteFile.replace(/\\/gi, "/"); // use forward slashes always
            tl.debug('remoteFile: ' + remoteFile);
            let stats = tl.stats(file);
            if (stats.isDirectory()) { // create directories if necessary
                outerPromises.push(thisHelper.createRemoteDirectory(remoteFile).then(() => {
                    thisHelper.progressTracking.directoryProcessed(remoteFile);
                }));
            }
            else if (stats.isFile()) { // upload files
                if (thisHelper.ftpOptions.overwrite) {
                    outerPromises.push(thisHelper.uploadFile(file, remoteFile).then(() => {
                        thisHelper.progressTracking.fileUploaded(file, remoteFile);
                    }));
                }
                else {
                    outerPromises.push(thisHelper.remoteExists(remoteFile).then((exists) => {
                        if (!exists) {
                            innerPromises.push(thisHelper.uploadFile(file, remoteFile).then(() => {
                                thisHelper.progressTracking.fileUploaded(file, remoteFile);
                            }));
                        }
                        else {
                            thisHelper.progressTracking.fileSkipped(file, remoteFile);
                        }
                    }));
                }
            }
        });
        Q.all(outerPromises).then(() => {
            Q.all(innerPromises).then(() => {
                defer.resolve(null);
            }).fail((err) => {
                defer.reject(err);
            });
        }).fail((err) => {
            defer.reject(err);
        });
        return defer.promise;
    }
    downloadFiles(files) {
        let thisHelper = this;
        thisHelper.progressTracking = new ProgressTracking(thisHelper.ftpOptions, files.length + 1); // add one extra for the root directory
        tl.debug('uploading files');
        let defer = Q.defer();
        let outerPromises = []; // these run first, and their then clauses add more promises to innerPromises
        let innerPromises = [];
        outerPromises.push(this.createRemoteDirectory(thisHelper.ftpOptions.remotePath).then(() => {
            thisHelper.progressTracking.directoryProcessed(thisHelper.ftpOptions.remotePath);
        })); // ensure root remote location exists
        files.forEach((file) => {
            tl.debug('file: ' + file);
            let remoteFile = thisHelper.ftpOptions.preservePaths ?
                path.join(thisHelper.ftpOptions.remotePath, file.substring(thisHelper.ftpOptions.rootFolder.length)) :
                path.join(thisHelper.ftpOptions.remotePath, path.basename(file));
            remoteFile = remoteFile.replace(/\\/gi, "/"); // use forward slashes always
            tl.debug('remoteFile: ' + remoteFile);
            let stats = tl.stats(file);
            if (stats.isDirectory()) { // create directories if necessary
                outerPromises.push(thisHelper.createRemoteDirectory(remoteFile).then(() => {
                    thisHelper.progressTracking.directoryProcessed(remoteFile);
                }));
            }
            else if (stats.isFile()) { // upload files
                if (thisHelper.ftpOptions.overwrite) {
                    outerPromises.push(thisHelper.uploadFile(file, remoteFile).then(() => {
                        thisHelper.progressTracking.fileUploaded(file, remoteFile);
                    }));
                }
                else {
                    outerPromises.push(thisHelper.remoteExists(remoteFile).then((exists) => {
                        if (!exists) {
                            innerPromises.push(thisHelper.uploadFile(file, remoteFile).then(() => {
                                thisHelper.progressTracking.fileUploaded(file, remoteFile);
                            }));
                        }
                        else {
                            thisHelper.progressTracking.fileSkipped(file, remoteFile);
                        }
                    }));
                }
            }
        });
        Q.all(outerPromises).then(() => {
            Q.all(innerPromises).then(() => {
                defer.resolve(null);
            }).fail((err) => {
                defer.reject(err);
            });
        }).fail((err) => {
            defer.reject(err);
        });
        return defer.promise;
    }
}
exports.FtpHelper = FtpHelper;
function getFtpOptions() {
    let options = new FtpOptions();
    if (tl.getInput('credsType') === 'serviceEndpoint') {
        // server endpoint
        let serverEndpoint = tl.getInput('serverEndpoint', true);
        options.serverEndpointUrl = url.parse(tl.getEndpointUrl(serverEndpoint, false));
        let serverEndpointAuth = tl.getEndpointAuthorization(serverEndpoint, false);
        options.username = serverEndpointAuth['parameters']['username'];
        options.password = serverEndpointAuth['parameters']['password'];
    }
    else if (tl.getInput('credsType') === 'inputs') {
        options.serverEndpointUrl = url.parse(tl.getInput('serverUrl', true));
        options.username = tl.getInput('username', true);
        options.password = tl.getInput('password', true);
    }
    // other standard options
    options.rootFolder = tl.getPathInput('rootFolder', true);
    options.filePatterns = tl.getDelimitedInput('filePatterns', '\n', true);
    options.remotePath = tl.getInput('remotePath', true).trim();
    // advanced options
    options.clean = tl.getBoolInput('clean', true);
    options.cleanContents = tl.getBoolInput('cleanContents', false);
    options.overwrite = tl.getBoolInput('overwrite', true);
    options.preservePaths = tl.getBoolInput('preservePaths', true);
    options.trustSSL = tl.getBoolInput('trustSSL', true);
    return options;
}
exports.getFtpOptions = getFtpOptions;
class ProgressTracking {
    constructor(ftpOptions, fileCount) {
        this.ftpOptions = null;
        this.fileCount = -1;
        this.progressFilesUploaded = 0;
        this.progressFilesSkipped = 0; // already exists and overwrite mode off
        this.progressDirectoriesProcessed = 0;
        this.ftpOptions = ftpOptions;
        this.fileCount = fileCount;
    }
    directoryProcessed(name) {
        this.progressDirectoriesProcessed++;
        this.printProgress('remote directory successfully created/verified: ' + name);
    }
    fileUploaded(file, remoteFile) {
        this.progressFilesUploaded++;
        this.printProgress('successfully uploaded: ' + file + ' to: ' + remoteFile);
    }
    fileSkipped(file, remoteFile) {
        this.progressFilesSkipped++;
        this.printProgress('skipping file: ' + file + ' remote: ' + remoteFile + ' because it already exists');
    }
    printProgress(message) {
        let total = this.progressFilesUploaded + this.progressFilesSkipped + this.progressDirectoriesProcessed;
        let remaining = this.fileCount - total;
        console.log('files uploaded: ' + this.progressFilesUploaded +
            ', files skipped: ' + this.progressFilesSkipped +
            ', directories processed: ' + this.progressDirectoriesProcessed +
            ', total: ' + total + ', remaining: ' + remaining +
            ', ' + message);
    }
    getSuccessStatusMessage() {
        return '\nhost: ' + this.ftpOptions.serverEndpointUrl.host +
            '\npath: ' + this.ftpOptions.remotePath +
            '\nfiles uploaded: ' + this.progressFilesUploaded +
            '\nfiles skipped: ' + this.progressFilesSkipped +
            '\ndirectories processed: ' + this.progressDirectoriesProcessed;
    }
    getFailureStatusMessage() {
        let total = this.progressFilesUploaded + this.progressFilesSkipped + this.progressDirectoriesProcessed;
        let remaining = this.fileCount - total;
        return this.getSuccessStatusMessage() +
            '\nunprocessed files & directories: ' + remaining;
    }
}
exports.ProgressTracking = ProgressTracking;
function findFiles(ftpOptions) {
    tl.debug('Searching for files to upload');
    let rootFolderStats = tl.stats(ftpOptions.rootFolder);
    if (rootFolderStats.isFile()) {
        let file = ftpOptions.rootFolder;
        tl.debug(file + ' is a file. Ignoring all file patterns');
        return [file];
    }
    let allFiles = tl.find(ftpOptions.rootFolder);
    // filePatterns is a multiline input containing glob patterns
    tl.debug('searching for files using: ' + ftpOptions.filePatterns.length + ' filePatterns: ' + ftpOptions.filePatterns);
    // minimatch options
    let matchOptions = { matchBase: true, dot: true };
    let win = tl.osType().match(/^Win/);
    tl.debug('win: ' + win);
    if (win) {
        matchOptions["nocase"] = true;
    }
    tl.debug('Candidates found for match: ' + allFiles.length);
    for (let i = 0; i < allFiles.length; i++) {
        tl.debug('file: ' + allFiles[i]);
    }
    // use a set to avoid duplicates
    let matchingFilesSet = new Set();
    for (let i = 0; i < ftpOptions.filePatterns.length; i++) {
        let normalizedPattern = path.join(ftpOptions.rootFolder, path.normalize(ftpOptions.filePatterns[i]));
        tl.debug('searching for files, pattern: ' + normalizedPattern);
        let matched = tl.match(allFiles, normalizedPattern, undefined, matchOptions);
        tl.debug('Found total matches: ' + matched.length);
        // ensure each result is only added once
        for (let j = 0; j < matched.length; j++) {
            let match = path.normalize(matched[j]);
            let stats = tl.stats(match);
            if (!ftpOptions.preservePaths && stats.isDirectory()) {
                // if not preserving paths, skip all directories
            }
            else if (matchingFilesSet.add(match)) {
                tl.debug('adding ' + (stats.isFile() ? 'file:   ' : 'folder: ') + match);
                if (stats.isFile() && ftpOptions.preservePaths) {
                    // if preservePaths, make sure the parent directory is also included
                    let parent = path.normalize(path.dirname(match));
                    if (matchingFilesSet.add(parent)) {
                        tl.debug('adding folder: ' + parent);
                    }
                }
            }
        }
    }
    return Array.from(matchingFilesSet).sort();
}
exports.findFiles = findFiles;
