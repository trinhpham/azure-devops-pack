import tl = require("vsts-task-lib/task");
import tr = require("vsts-task-lib/toolrunner");

import {TaskQueue} from 'typescript-task-queue'

let taskQueue = new TaskQueue();

// Add a function to the queue
taskQueue.enqueue(() => {
    // Some async code will run here
    // ...
});

// Start the queue
taskQueue.start();

// Stop the queue
taskQueue.

// Callback on start
taskQueue.on('start', () => {
    // ...
});

// Callback on stop
taskQueue.on('stop', () => {
    // ...
});