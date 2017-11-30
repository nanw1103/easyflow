"use strict";

const util = require('util')

function isPromise(o) {
	if (!o)
		return false
	return typeof o === 'object' && typeof o.then === 'function'
}

function isClass(v) {
	return typeof v === 'function' && /^\s*class\s+/.test(v.toString());
}

function genId() {
	let n = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)
	return 'T' + n	//must not be numeric id, even string. Otherwise the order will not be kept in an object.
}

class WfTask {
	constructor(workflow, isParallel, args) {
				
		Object.defineProperty(this, 'workflow', {value: workflow})
		
		if (isParallel)
			this.isParallel = isParallel
		
		let status = {children: {}}
		Object.defineProperty(this, '_status', { configurable: true, value: status})
		
		let start
		if (typeof args[0] === 'string') {
			start = 1
			status.name = args[0]
		} else {
			start = 0
		}
		
		let tasks = [].slice.call(args, start)		
		for (let i = 0; i < tasks.length; i++) {
			let t = tasks[i]

			//if already WfTask, we are fine with it
			if (t instanceof WfTask) {
				if (t.workflow !== workflow) {
					//this is a nested workflow
					t.workflow.parent = workflow
					continue
				}
				let chain = workflow._removeChain(t)
				if (chain.tasks.length === 1)
					chain = chain.tasks[0]
				tasks[i] = chain
				chain.parent = this
				continue
			}
			
			if (typeof t !== 'function')
				throw 'Invalid task item type. Must be function or class. t=' + util.inspect(t)
			
			if (!isClass(t))
				continue	//a bare function. We are fine with it
			
			function getMsgHandler(n) {
				return (msg) => {
					if (tasks[n]._status)
						tasks[n]._status.message = msg
				}
			}
			let instance = new t(getMsgHandler(i))
			
			let parallel
			let items
			if (Array.isArray(instance.sequence)) {
				items = instance.sequence
			} else if (Array.isArray(instance.parallel)) {
				items = instance.parallel
				parallel = true
			} else {
				throw 'Task item is a class, but missing "sequence" (or "parallel") property to define sub tasks'
				continue
			}
			
			for (let j = 0; j < items.length; j++)
				items[j] = items[j].bind(instance)
			
			if (instance.name)
				items.unshift(instance.name)
			tasks[i] = new WfTask(this.workflow, parallel, items).id(t.name)
			tasks[i].parent = this
		}
		this.tasks = tasks
	}
	
	_formalize() {
		if (!this._id)
			Object.defineProperty(this, '_id', {value: genId()})
		for (let i = 0; i < this.tasks.length; i++) {
			let t = this.tasks[i]
			if (t instanceof WfTask) {
				if (t._formalize())
					this._status.children[t._id] = t._status
			}
		}
		if (this.workflow.isDisabled(this._id))
			this._status.status = 'skipped'
		
		if (!this._status) 
			console.log('???')
		if (Object.keys(this._status.children).length === 0)
			delete this._status.children
		if (Object.keys(this._status).length === 0)
			delete this._status
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
		let task = new WfTask(this.workflow, false, arguments)
		this.parent._addChild(task)
		return task
	}
	
	parallel() {
		let task = new WfTask(this.workflow, true, arguments)		
		this.parent._addChild(task)
		return task
	}
	
	_addChild(child) {
		child.parent = this
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
	
	_findStatus() {
		for (let t = this; t; t = t.parent)
			if (t._status && t._status.name)
				return t._status
	}
	
	_runImpl(passOn) {
		let status = this._findStatus()
		let name = this._status ? this._status.name : undefined
		let thisContext = {
			message: (msg) => status ? (status.message = msg) : undefined,
			workflow: this.workflow
		}
		
		let workflow = this.workflow
		function isDisabled(id) {
			return workflow.isDisabled(id)
		}
		
		let verbose = this.workflow._verbose
		function log() {
			if (verbose) {
				let args = [].slice.call(arguments)
				args.unshift('[easyflow] -')
				console.log.apply(console, args)
			}
		}
		
		let id = this._id
		if (isDisabled(id)) {
			if (name) {
				status.status = 'skipped'
				log('skipped:', name)
			} else {
				log('skipped: (id)', id)
			}
			workflow._fireStatusChange(this, 'skipped')
			return Promise.resolve()
		}
		
		let tasks = this.tasks
		
		return new Promise((resolve, reject) => {
						
			if (name) {
				status.status = 'running'
				log('start:', name)
			}
			workflow._fireStatusChange(this, 'running')
			let me = this
			
			function completeMe(err, data) {				
				if (err) {
					if (name) {
						status.status = 'error'
						log('error:', name)
					}
					workflow._fireStatusChange(me, 'error')
					reject(err)
				} else {
					if (name) {
						status.status = 'complete'
						log('complete:', name)
					}
					workflow._fireStatusChange(me, 'complete')
					resolve(data)
				}
			}
			
			try {			
				if (this.isParallel) {
					
					let finished = 0
					let parallelResult = []
					
					function callOneParallel(obj) {
						if (isPromise(obj)) {
							obj.then((ret) => {
								
								parallelResult.push(ret)
								
								if (++finished == tasks.length) {
									completeMe(null, parallelResult)
								}
							}).catch((err) => {
								completeMe(err)
							})
						} else {
							
							parallelResult.push(obj)
							
							if (++finished == tasks.length)
								completeMe(null, parallelResult)
						}
					}
					
					for (let i = 0; i < this.tasks.length; i++) {
						let t = tasks[i]
												
						if (typeof t === 'function') {							
							if (isDisabled(t)) {
								log('skipped:', t.name)
								continue
							}
							callOneParallel(t.call(thisContext, passOn))
						} else if (t instanceof WfTask) {
							callOneParallel(t._runImpl(passOn))
						} else {
							throw 'Invalid object type:' + typeof t
						}
					}
					
				} else {
					let nextIdx = 0
					
					function continueCall(obj) {
						
						if (isPromise(obj)) {
							
							obj.then((ret) => {
								passOn = ret
								setTimeout(runOne, 0)
							}).catch((err) => {
								completeMe(err)
							})
						} else {
							setTimeout(runOne, 0)
						}
					}
					
					function runOne() {
						if (nextIdx >= tasks.length) {
							completeMe(null, passOn)
							return
						}
						
						let t = tasks[nextIdx++]
						
						if (typeof t === 'function') {
							if (isDisabled(t)) {
								log('skipped:', t.name)
								setTimeout(runOne, 0)
								return
							}
						
							continueCall(t.call(thisContext, passOn))
						} else if (t instanceof WfTask) {
							continueCall(t._runImpl(passOn))
						} else {
							throw 'Invalid task object type: ' + typeof t
						}
					}
					
					runOne()
				}
			} catch (e) {
				completeMe(e)
			}
		})
	}
	
	run(passOn) {
		return this.workflow.run(passOn)
	}
	
	status() {
		return this.workflow.status()
	}
	
	onStatus(cb) {
		this.workflow.onStatus(cb)
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
		this._verbose = true
	}
	
	sequence() {
		let t = new WfTask(this, false, arguments)
		this._addChain()._addChild(t)
		return t
	}
	
	parallel() {
		let t = new WfTask(this, true, arguments)
		this._addChain()._addChild(t)
		return t
	}
	
	id(id) {
		if (id)
			this._id = id
		return this._id
	}
	
	_addChain() {
		let chain = new WfTask(this, false, [])
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
		ids.forEach((id) => {
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
		ids.forEach((id) => {
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
	
	_fireStatusChange(task, status) {
		let name = task._status ? task._status.name : undefined
		
		if (!name)
			return
		
		if (this._onStatus)
			this._onStatus(task._id, name, status)
		if (this.parent)
			this.parent._fireStatusChange(task._id, name, status)
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
		if (this.roots.length !== 1)
			throw 'workflow root is not unique. roots.length=' + this.roots.length
		
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
