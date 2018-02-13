'use strict';

const util = require('util')

function isPromise(o) {
	if (!o)
		return false
	return typeof o === 'object' && typeof o.then === 'function'
}

function isClass(v) {
	return typeof v === 'function' && /^\s*class\s+/.test(v.toString());
}

if (!String.prototype.padEnd) {
	String.prototype.padEnd = function(len, char) {
		char = char || ' '
		let s = this
		while (s.length < len)
			s += char
		return s
	}
}

class TaskUnit {
	constructor(workflow) {
		
		Object.defineProperty(this, 'workflow', {value: workflow})
		
		let status = {}
		Object.defineProperty(this, '_status', { configurable: true, value: status})
		
		Object.defineProperty(this, 'parent', { writable: true })
		//this.parallel = undefined
		
		//this.func = undefined
		//this.tasks = undefined
	}
	
	static wrapFunc(workflow, func) {
		let t = new TaskUnit(workflow)
		t.id(func.name)
		t.func = passOn => func.call(t, passOn, (...args) => t.message.apply(t, args))
		return t
	}
	
	static wrapBoundFunc(workflow, className, instance, func) {
		let t = new TaskUnit(workflow)
		t.id(className + '.' + func.name)
		t.func = passOn => func.call(instance, passOn, (...args) => t.message.apply(t, args))
		return t
	}
	
	static wrapClass(workflow, clazz) {
		let unit = new TaskUnit(workflow)
		let instance = new clazz()
			
		let items
		if (Array.isArray(instance.sequence)) {
			items = instance.sequence
		} else if (Array.isArray(instance.parallel)) {
			items = instance.parallel
			unit.isParallel = true
		} else {
			throw 'Task item is a class, but missing "sequence" (or "parallel") property to define sub tasks'
		}
		
		for (let j = 0; j < items.length; j++) {
			if (!items[j])
				throw 'Task item is undefined: ' + clazz.name + '.' + (parallel ? 'parallel' : 'sequence') + '[' + j + ']'
			items[j] = TaskUnit.wrapBoundFunc(workflow, clazz.name, instance, items[j])
			items[j].parent = unit
		}
		
		if (instance.name)
			unit._status.name = instance.name
		unit.id(clazz.name)		
		unit.tasks = items
		return unit
	}
	
	static wrapArgs(workflow, args) {		
		let unit = new TaskUnit(workflow)
		
		let start
		if (typeof args[0] === 'string') {
			start = 1
			unit._status.name = args[0]
		} else {
			start = 0
		}
		
		let tasks = [].slice.call(args, start)		
		for (let i = 0; i < tasks.length; i++) {
			let t = tasks[i]

			if (t instanceof Easyflow) {
				t.status()
				t = t.roots[0]
				tasks[i] = t
			}
			
			//if already TaskUnit, we are fine with it
			if (t instanceof TaskUnit) {
				if (t.workflow !== workflow) {
					//this is a nested workflow
					t.workflow.parent = workflow
					continue
				}
				let chain = workflow._removeChain(t)
				if (chain.tasks.length === 1)
					chain = chain.tasks[0]
				tasks[i] = chain
				chain.parent = unit
				continue
			}
			
			if (typeof t !== 'function')
				throw 'Invalid task item type. Must be function or class. t=' + util.inspect(t)
			
			if (!isClass(t)) {	//a bare function. Wrap as a single TaskUnit				
				t = TaskUnit.wrapFunc(workflow, t)
				t.parent = unit
				tasks[i] = t
				continue
			}
			
			//a task class. Always create instance to clear state
			t = TaskUnit.wrapClass(workflow, t)
			t.parent = unit
			tasks[i] = t
		}
		unit.tasks = tasks
		return unit
	}
	
	message(...args) {
		let status = this._findNamedStatus()
		let name		
		let msg = util.format.apply(null, args)
		if (status) {
			status.message = msg
			name = status.name
		}
		this.workflow._fireMessageChange(this._id, name, msg)
	}
	
	_formalize() {
		
		let children = []
		if (this.tasks) {
			for (let i = 0; i < this.tasks.length; i++) {
				let t = this.tasks[i]
				if (t instanceof TaskUnit) {
					if (t._formalize())
						children.push(t._status)
				}
			}
		}
		if (this.workflow.isDisabled(this._id))
			this._status.status = 'skipped'
		
		if (children.length > 0)
			this._status.children = children

		if (this._status) {
			if (Object.keys(this._status).length === 0)
				delete this._status
			else if (this._id)
				this._status.id = this._id
		}

		return this._status
	}
	
	id(id) {
		if (id) {
			this._id = id
			return this
		}
		return this._id
	}
		
	sequence() {
		let task = TaskUnit.wrapArgs(this.workflow, arguments)
		this.parent._addChild(task)
		return task
	}
	
	parallel() {
		let task = TaskUnit.wrapArgs(this.workflow, arguments)
		task.isParallel = true
		this.parent._addChild(task)
		return task
	}
	
	_addChild(child) {
		child.parent = this
		if (!this.tasks)
			this.tasks = [child]
		else
			this.tasks.push(child)
	}
	
	disable() {
		this.workflow.disable.apply(this.workflow, arguments)
		return this		
	}
	
	enable() {
		this.workflow.enable.apply(this.workflow, arguments)
		return this
	}
	
	_findNamedStatus() {
		for (let t = this; t; t = t.parent)
			if (t._status && t._status.name)
				return t._status
	}
		
	_runImpl(passOn) {
		let status = this._findNamedStatus()
		let workflow = this.workflow

		let verbose = this.workflow._verbose
		function log() {
			if (verbose) {
				let args = [].slice.call(arguments)
				args.unshift('[easyflow] -')
				console.log.apply(console, args)
			}
		}
		
		let me = this
		
		function changeStatus(stat, data) {
			let isMajor = me._status && me._status.name
			let displayName = status ? status.name : ''
			if (me._id) {
				let connectors = {
					running: ' >> ',
					skipped: ' -- ',
					complete: ' << ',
					error: ' << '
				}
				displayName += connectors[stat] + me._id
			}
				
			if (isMajor) {
				status.status = stat
				if (stat === 'running')
					displayName = (displayName + ' ').padEnd(55, '-')
				log((stat + ':').toUpperCase().padEnd(10), displayName)
			} else {
				me._id && log((stat + ':').padEnd(10), displayName)
			}
			workflow._fireStatusChange(me, stat, data)
		}
		
		if (workflow.isDisabled(this._id)) {
			changeStatus('skipped')
			return Promise.resolve(passOn)
		}
				
		changeStatus('running')
		
		if (this.func) {
			let ret = this.func(passOn)
			if (isPromise(ret)) {
				return ret.then(data => {
					changeStatus('complete', data)
					return Promise.resolve(data)
				}).catch(err => {
					changeStatus('error', err)
					return Promise.reject(err)
				})
			}
			changeStatus('complete', ret)
			return ret
		}
		
		let tasks = this.tasks		
		
		return new Promise((resolve, reject) => {
			function completeMe(success, data) {
				if (success) {
					changeStatus('complete', data)
					resolve(data)
				} else {
					changeStatus('error', data)
					reject(data)
				}
			}
			
			try {			
				if (this.isParallel) {
					
					let finished = 0
					let parallelResult = []
					
					function callOneParallel(obj) {
						if (isPromise(obj)) {
							obj.then(ret => {
								parallelResult.push(ret)
								
								if (++finished == tasks.length)
									completeMe(true, parallelResult)
								
							}).catch(err => {
								completeMe(false, err)
							})
						} else {
							parallelResult.push(obj)
							
							if (++finished == tasks.length)
								completeMe(true, parallelResult)
						}
					}
					
					for (let i = 0; i < tasks.length; i++) {
						let t = tasks[i]
												
						if (!(t instanceof TaskUnit))
							throw 'Invalid task object type:' + typeof t
						
						callOneParallel(t._runImpl(passOn))
					}
					
				} else {
					let nextIdx = 0
					
					function continueCall(obj) {
						
						if (isPromise(obj)) {
							
							obj.then(ret => {
								passOn = ret
								setTimeout(runOne, 0)
							}).catch(err => {
								completeMe(false, err)
							})
						} else {
							setTimeout(runOne, 0)
						}
					}
					
					function runOne() {
						if (nextIdx >= tasks.length) {
							completeMe(true, passOn)
							return
						}
						
						let t = tasks[nextIdx++]
						
						if (!(t instanceof TaskUnit))
							throw 'Invalid task object type: ' + typeof t
						
						continueCall(t._runImpl(passOn))
					}
					
					runOne()
				}
			} catch (e) {
				completeMe(false, e)
			}
		})
	}
	
	run(passOn) {
		return this.workflow.run(passOn)
	}
	
	status(unitOnly) {
		return unitOnly ? this._status : this.workflow.status()
	}
	
	onStatus(cb) {
		this.workflow.onStatus(cb)
		return this
	}
	
	onMessage(cb) {
		this.workflow.onMessage(cb)
		return this
	}
	
	verbose(enabled) {
		this.workflow.verbose(enabled)
		return this
	}	
}

class Easyflow {
	
	constructor(name) {
		this.disabledIds = new Set()
		this.dependency = {}
		this.roots = []
		this.name = name
		Object.defineProperty(this, '_verbose', {value: true, writable: true})
	}
	
	sequence() {
		let t = TaskUnit.wrapArgs(this, arguments)
		this._addChain()._addChild(t)
		return t
	}
	
	parallel() {
		let t = TaskUnit.wrapArgs(this, arguments)
		t.isParallel = true
		this._addChain()._addChild(t)
		return t
	}
	
	id(id) {
		if (id) {
			this._id = id
			return this
		}
		return this._id
	}
	
	_addChain() {
		let chain = new TaskUnit(this, [])
		this.roots.push(chain)
		return chain
	}
	
	_removeChain(t) {
		for (let i = 0; i < this.roots.length; i++) {
			if (this.roots[i] === t.parent) {
				this.roots.splice(i, 1)
				return t.parent
			}
		}
		throw '_removeChain: parent not found. How could this be?'
	}
	
	/*
	 *	Disable the specified task(s).
	 */
	disable(/*id...*/) {
		let ids = [].slice.call(arguments)
		let disabledIds = this.disabledIds
		ids.forEach(id => {
			if (typeof id === 'function')
				id = id.name
			disabledIds.add(id)
		})
		return this
	}
	
	/*
	 *	Enable the specified task(s)
	 */
	enable(/*id...*/) {
		let ids = [].slice.call(arguments)
		let disabledIds = this.disabledIds
		ids.forEach(id => {
			if (typeof id === 'function')
				id = id.name
			disabledIds.delete(id)
		})
		return this
	}
		
	isDisabled(t) {
		if (typeof t === 'function')
			t = t.name
		if (this.disabledIds.has(t))
			return true
		if (this.parent)
			return this.parent.isDisabled(t)
		//false
	}
	
	status() {
		if (!this.statusObj)
			this._formalize()
		return this.statusObj
	}
	
	onStatus(cb) {
		this._onStatus = cb
		return this
	}

	onMessage(cb) {
		this._onMessage = cb
		return this
	}

	_fireStatusChange(task, status) {
				
		let name = task._status ? task._status.name : undefined
		
		if (!task._id && !name)
			return
		
		if (this._onStatus)
			this._onStatus(task._id, name, status)
		if (this.parent)
			this.parent._fireStatusChange(task, status)
	}

	_fireMessageChange(id, name, message) {
		
		if (this._onMessage)
			this._onMessage(id, name, message)
		if (this.parent)
			this.parent._fireMessageChange(id, name, message)
	}

	verbose(enabled) {
		this._verbose = enabled
		return this
	}
	
	setDependency(/*id, dep...*/) {
		if (arguments.length < 2)
			throw 'Invalid parameter count: setDependency'
		let id = arguments[0]
		let dep
		if (arguments.length === 2)
			dep = arguments[1]
		else
			dep = [].slice.call(arguments, 1)

		this.dependency[id] = dep
		
		return this
	}
	
	_formalize() {
		if (this.roots.length !== 1) {
			console.log(util.inspect(this.roots))
			throw 'workflow root is not unique. roots.length=' + this.roots.length
		}
		
		let t = this.roots[0]
		if (t.tasks.length === 1) {
			t = t.tasks[0]
			this.roots[0] = t
		}
		
		let status = t._formalize()
		if (!status)
			status = {}
		return this.statusObj = status
	}
	
	run(context) {
		if (this.roots.length === 0)
			return Promise.resolve()
		
		this.status()
		
		return this.roots[0]._runImpl(context)
	}
}

module.exports = Easyflow
