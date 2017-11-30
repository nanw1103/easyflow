'use strict';

//Task can be wrapped as an object for clarity, as well as sharing context via member variable
class MyBigTask {
	
	constructor() {
		//Define the task sequence in this class. Could be either this.sequence, or this.parallel
		this.sequence = [this.task1, this.task2, this.task3]
		
		//optionally, task name can be specified
		this.name = 'A Big Task'
		
		//By default, subtasks are executed in sequence. Optionally, run them in parallel by setting this.parallel insteadof this.sequence
		//this.parallel = [this.task1, this.task2, this.task3]
	}
	
	task1() {
		this.n = 0
		
		console.log('MyBigTask.subtask1, this.n=', this.n++)
	}
	
	task2(param, msg) {
		
		//Demo reporting message in the current named step
		msg('This is an optional status message from MyBigTask')
				
		console.log('MyBigTask.subtask2, this.n=', this.n++)
	}
	
	task3() {
		console.log('MyBigTask.subtask3, this.n=', this.n++)
	}
}

module.exports = MyBigTask

