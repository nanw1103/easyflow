/*
Easyflow provides a centralized view for workflow definition. It provides clear and robust workflow by 
moving flow dependency out from business logic unit.
*/

const Easyflow = require('./index.js')

const util = require('util')
const MySubFlow = require('./MySubFlow.js')
const MyBigTask = require('./MyBigTask.js')

//----------------------------------------------------------------------------
Promise.resolve()
.then(demo1)
.then(demo2)
.then(demo3)
.then(demo4)
.then(demo5)
.then(demo6)
.then(() => {
	console.log('Demo complete')
}).catch((e) => {
	console.log('Demo error:', e)
})
//----------------------------------------------------------------------------
function demo1() {
	console.log()
	console.log('-------------------- demo1: basic --------------------')
	console.log()
	
	/*
	[Task Unit]
	Use easyflow.sequence(...) to wrap a series of tasks to run in sequence, as a Task Unit.
	easyflow.parallel(...) wraps a series of tasks to run in parallel.

	Chained .sequence/.parallel will be executed in sequence
	*/
	
	/*
                            /- tsak4 -\
    task1 -> task2 -> task3 -> task5 -> task7 -> task8
                            \- task6 -/
	*/
		
	return new Easyflow().sequence(
		task1,
		task2,
		task3
	).parallel(
		task4,
		task5,
		task6
	).sequence(
		task7,
		task8
	).run('my initial param for the first task')
	.then((result) => {
		console.log('Success. Result:', result)
	})
}
//----------------------------------------------------------------------------
function demo2() {
	console.log()
	console.log('-------------------- demo2: nested task --------------------')
	console.log()
	
	/*
	Tasks can be a bare function, another Task Unit, another easyflow, or a task class (described later).
	Task can be nested.
	*/
	
	let flow = new Easyflow()

	return flow.sequence(
		task1,
		task2,
		task3
	).parallel(
		task4,
		flow.sequence(task5, task6, task7),
		flow.sequence(task8, task9)
	).sequence(
		task10,
		flow.parallel(
			flow.sequence(task11, task12),
			flow
				.sequence(task13, task14, task15)
				.sequence(task16, task17),
			flow.sequence(task18, task19)
		),
		task20
	).run()
}
//----------------------------------------------------------------------------
function demo3() {
	console.log()
	console.log('-------------------- demo3: Status --------------------')
	console.log()
	
	/*
	[Named Task Unit and Status Object]
	If the first parameter for .sequence() or .parallel() is a string, then the unit is a Named Unit, which
	has a status object associated with it:
	{
		status: '<pending|skipped|error|complete>',
		message: '<message>',
		error: '<error message, optional>'
	}

	The 'status' property will be automatically updated by framework upon start/complete/error, or 'skipped' if being disabled.
	Concrete task function can update the 'message' property of its owning status object in the following way:
	
	function task1() {
		this.message = 'Hello, mortal.'
	}
	
	Message from nested anonymous subtask will be updated to the status object of the first named ascenstor unit, if any.
	*/
	
	let flow = new Easyflow()

	flow.sequence('Major task 1',	//named task unit
		task1,
		task2,
		task3
	).parallel('Major task 2 (parallel)',
		task4,
		flow.sequence(task5, task6, task7),	//nested, anonymous task unit
		flow.sequence(task8, task9)
	).sequence('Major task 3',
		task10,
		flow.parallel(
			flow.sequence(task11, task12),
			flow
				.sequence('Named subtask 4', task13, task14, task15)
				.sequence('Named subtask 5', task16, task17),
			flow.sequence(task18, task19)
		),
		task20
	)
	
	//flow.status() will be updated automatically along the execution of tasks, 
	//and can be retrieved any time. E.g. continuously polled by UI
	let status = flow.status()
	console.log('Status', util.inspect(status, null, 4))
	
	//optionally, status event can be hooked. For named units only.
	flow.onStatus((id, name, status) => {
		console.log('onStatus: name=' + name + ', id=' + id + ', status=' + status)
	})
	
	return flow.run().then((result) => {
		console.log('Status', util.inspect(status, null, 4))
	})	
}
//----------------------------------------------------------------------------
function demo4() {
	console.log()
	console.log('-------------------- demo4: nested easyflow, and task class --------------------')
	console.log()
	
	/*
	Subtask can also be another easyflow, or a task class, imported from other modules
	*/
	
	let subflow = MySubFlow()
	
	let flow = new Easyflow().sequence('Demo nested easyflow & task class',
		task1,
		MyBigTask,	//a task class
		subflow,	//another flow. If you want to enable/disable it, use "subflow.id('...')," here to specify an id for the subflow.
		task3
	)
	return flow.run().then(() => {
		console.log('Status:', util.inspect(flow.status(), null, 4))
	})
}
//----------------------------------------------------------------------------
function demo5() {
	console.log()
	console.log('-------------------- demo5: nested status --------------------')
	console.log()
	
	let flow = new Easyflow()
	
	//message issued by anonymous subtask (task103, task104) will go to status object of the owner named task 'DemoMessage¡®
	
	flow.sequence('DemoMessage',
		task101,
		task102,
		flow.sequence(task103, task104),
		task105
	)
	
	let status = flow.status()
	console.log('Status:', status)
	let n = 0
	let timer = setInterval(() => {
		console.log(status)
		if (++n == 6)
			clearInterval(timer)
	}, 1000)
	
	return flow.run()
}

//----------------------------------------------------------------------------
function demo6() {
	console.log()
	console.log('---------- demo6: disable tasks ----------')
	console.log()
		
	let subflow = MySubFlow().id('myNestedFlow')
	
	function demo6func1() {
		this.workflow
			.disable(task6)	//programmatically disable a task
			.enable(task7)	//enable a disabled task at run time(from config)
	}
	
	return new Easyflow().sequence(
		task1,
		task2			//will not run.
	).parallel(			//specify an id for this unit. The step is also disabled and will not run
		task3,
		task4
	).id('myStep2')		
	.sequence(
		task5, 			//will not run.
		MyBigTask,		//task class has ID matches its name. It's disabled later and will not run.
		subflow,		//sub-flow has ID assigned previously. It's disabled later and will not run.
		demo6func1,
		task6,			//will not run. Programmatically disabled in demo6func1
		task7			//Configured as disabled, but programmatically enabled in demo6func1
	).disable(task2, task5, task7, 'myStep2', MyBigTask, 'myNestedFlow')	//disable some tasks
	.run()
}

//----------------------------------------------------------------------------
function task1(param) {
	let name = arguments.callee.name	
	let message = this.message
	return new Promise((resolve, reject) => {
		setTimeout(() => {
			console.log(name)
			if (param)
				console.log('param in task1:', param)
			message('Hello from ' + name)
			resolve(11)
		}, 1000)
	})
}

function task2(data) {
	let name = arguments.callee.name		
	return new Promise((resolve, reject) => {
		setTimeout(() => {
			if (data)
				console.log(name, '- data inherited from previous task resolve():', data)
			else
				console.log(name)
			
			resolve()
		}, 1000)		
	})
}

function task3(data) {
	let name = arguments.callee.name
	return new Promise((resolve, reject) => {
		setTimeout(() => {
			console.log(name)
			resolve()
		}, 1000)		
	})
}

function task4() {
	let name = arguments.callee.name
	
	//you can set message in status object, of the named task unit
	let message = this.message
	
	return new Promise((resolve, reject) => {
		setTimeout(() => {
			message('Hello from ' + name)
			console.log(name)
			resolve()
		}, 1000)		
	})
}

function task5() {
	let name = arguments.callee.name		
	return new Promise((resolve, reject) => {
		setTimeout(() => {
			console.log(name)
			resolve()
		}, 1000)		
	})
}

function task6() {
	let name = arguments.callee.name		
	return new Promise((resolve, reject) => {
		setTimeout(() => {
			console.log(name)
			resolve()
		}, 1000)		
	})
}

function task7() {
	let name = arguments.callee.name		
	return new Promise((resolve, reject) => {
		setTimeout(() => {
			console.log(name)
			resolve()
		}, 1000)		
	})
}

function task8() {
	let name = arguments.callee.name		
	return new Promise((resolve, reject) => {
		setTimeout(() => {
			console.log(name)
			resolve('Hello from ' + name)
		}, 1000)		
	})
}

function task9() {
	let name = arguments.callee.name		
	return new Promise((resolve, reject) => {
		setTimeout(() => {
			console.log(name)
			resolve()
		}, 1000)		
	})
}

function task10() {
	let name = arguments.callee.name		
	return new Promise((resolve, reject) => {
		setTimeout(() => {
			console.log(name)
			resolve()
		}, 1000)		
	})
}

function task11() {
	let name = arguments.callee.name		
	return new Promise((resolve, reject) => {
		setTimeout(() => {
			console.log(name)
			resolve('Hello from ' + name)
		}, 1000)		
	})
}

function task12() {
	let name = arguments.callee.name		
	return new Promise((resolve, reject) => {
		setTimeout(() => {
			console.log(name)
			resolve()
		}, 1000)		
	})
}

function task13() {
	let name = arguments.callee.name		
	return new Promise((resolve, reject) => {
		setTimeout(() => {
			console.log(name)
			resolve()
		}, 1000)		
	})
}

function task14() {
	let name = arguments.callee.name
	let message = this.message
	return new Promise((resolve, reject) => {
		setTimeout(() => {
			message('Hello from ' + name)
			console.log(name)
			resolve()
		}, 1000)		
	})
}

function task15() {
	let name = arguments.callee.name		
	return new Promise((resolve, reject) => {
		setTimeout(() => {
			console.log(name)
			resolve()
		}, 1000)		
	})
}

function task16() {
	let name = arguments.callee.name		
	return new Promise((resolve, reject) => {
		setTimeout(() => {
			console.log(name)
			resolve()
		}, 1000)		
	})
}

function task17() {
	let name = arguments.callee.name		
	return new Promise((resolve, reject) => {
		setTimeout(() => {
			console.log(name)
			resolve()
		}, 1000)		
	})
}

function task18() {
	let name = arguments.callee.name		
	return new Promise((resolve, reject) => {
		setTimeout(() => {
			console.log(name)
			resolve()
		}, 1000)		
	})
}

function task19() {
	let name = arguments.callee.name		
	return new Promise((resolve, reject) => {
		setTimeout(() => {
			console.log(name)
			resolve()
		}, 1000)		
	})
}

function task20() {
	let name = arguments.callee.name		
	return new Promise((resolve, reject) => {
		setTimeout(() => {
			console.log(name)
			resolve()
		}, 1000)		
	})
}

function task101() {
	let name = arguments.callee.name
	let message = this.message
	return new Promise((resolve, reject) => {
		setTimeout(() => {
			message('Hello from ' + name)
			resolve()
		}, 1000)		
	})
}

function task102() {
	let name = arguments.callee.name
	let message = this.message
	return new Promise((resolve, reject) => {
		setTimeout(() => {
			message('Hello from ' + name)
			resolve()
		}, 1000)		
	})
}

function task103() {
	let name = arguments.callee.name
	let message = this.message
	return new Promise((resolve, reject) => {
		setTimeout(() => {
			message('Hello from ' + name)
			resolve()
		}, 1000)		
	})
}

function task104() {
	let name = arguments.callee.name
	let message = this.message
	return new Promise((resolve, reject) => {
		setTimeout(() => {
			message('Hello from ' + name)
			resolve()
		}, 1000)		
	})
}

function task105() {
	let name = arguments.callee.name
	let message = this.message
	return new Promise((resolve, reject) => {
		setTimeout(() => {
			message('Hello from ' + name)
			resolve()
		}, 1000)		
	})
}