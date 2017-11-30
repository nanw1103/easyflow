
const Easyflow = require('./index.js')
const MyBigTask = require('./MyBigTask.js')

function createAComplexFlow(name) {
	return new Easyflow(name).sequence(
		//'MySubFlow',
		//task1,
		//task2,
		MyBigTask
	)
}

function task1(param) {
	let message = this.message
	return new Promise((resolve, reject) => {
		console.log('MySubFlow.task1.param:', param)
		message('Hello from MySubFlow.task1')
		resolve(param)
	})
}

function task2(param) {
	return new Promise((resolve, reject) => {
		console.log('MySubFlow.task2.param:', param)
		resolve()
	})
}

module.exports = createAComplexFlow

