'use strict';

const Easyflow = require('./index.js')

function createAComplexFlow(name) {
	return new Easyflow(name).sequence('MySubFlowSequence1',
		task1,
		task2
	)
}

function task1(param, msg) {
	return new Promise((resolve, reject) => {
		console.log('MySubFlow.task1.param:', param)
		msg('Hello from MySubFlow.task1')
		resolve(param)
	})
}

function task2(param) {	
	console.log('MySubFlow.task2.param:', param)
	return 'something from MySubFlow'
}

module.exports = createAComplexFlow

