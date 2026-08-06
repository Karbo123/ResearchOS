export type TaskWorkerDispatcherRuntime<Task> = {
  claim(workerId: string): Promise<Task | null>
  execute(task: Task): Promise<void>
  heartbeat(workerIds: readonly string[]): Promise<void>
  isFatal(error: unknown): boolean
  onFatal(error: unknown): void
  onError(error: unknown): void
}

export type TaskWorkerDispatcherOptions = {
  concurrency: number
  minimumIdleDelayMs?: number
  maximumIdleDelayMs?: number
  heartbeatIntervalMs?: number
  workerId?: (sequence: number) => string
}

export type TaskWorkerDispatcherHandle = {
  stop(): void
  readonly done: Promise<void>
  stats(): { active: number; idleDelayMs: number; stopped: boolean }
}

export function startTaskWorkerDispatcher<Task>(
  runtime: TaskWorkerDispatcherRuntime<Task>,
  options: TaskWorkerDispatcherOptions,
): TaskWorkerDispatcherHandle {
  const concurrency = Math.max(1, Math.min(32, options.concurrency))
  const minimumIdleDelayMs = Math.max(10, options.minimumIdleDelayMs ?? 250)
  const maximumIdleDelayMs = Math.max(minimumIdleDelayMs, options.maximumIdleDelayMs ?? 5_000)
  const heartbeatIntervalMs = Math.max(10, options.heartbeatIntervalMs ?? 30_000)
  const workerId = options.workerId ?? (sequence => `worker-${process.pid}-${sequence}-${crypto.randomUUID().slice(0, 6)}`)
  const lifecycle = new AbortController()
  const active = new Map<Promise<void>, string>()
  const wakeListeners = new Set<() => void>()
  let idleDelayMs = minimumIdleDelayMs
  let workerSequence = 0
  let fatal = false

  const wake = () => {
    for (const listener of [...wakeListeners]) listener()
  }
  const waitForWake = (milliseconds?: number) => new Promise<void>(resolve => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = () => {
      if (timer) clearTimeout(timer)
      lifecycle.signal.removeEventListener('abort', finish)
      wakeListeners.delete(finish)
      resolve()
    }
    wakeListeners.add(finish)
    lifecycle.signal.addEventListener('abort', finish, { once: true })
    if (milliseconds !== undefined) timer = setTimeout(finish, milliseconds)
  })
  const sleep = (milliseconds: number) => new Promise<void>(resolve => {
    let timer: ReturnType<typeof setTimeout>
    const finish = () => {
      clearTimeout(timer)
      lifecycle.signal.removeEventListener('abort', finish)
      resolve()
    }
    lifecycle.signal.addEventListener('abort', finish, { once: true })
    timer = setTimeout(finish, milliseconds)
  })
  const failFatally = (error: unknown) => {
    if (fatal) return
    fatal = true
    lifecycle.abort(error)
    wake()
    runtime.onFatal(error)
  }
  const handleFailure = (error: unknown) => {
    if (runtime.isFatal(error)) failFatally(error)
    else runtime.onError(error)
  }

  const dispatcher = (async () => {
    while (!lifecycle.signal.aborted) {
      let claimed = false
      while (!lifecycle.signal.aborted && active.size < concurrency) {
        const nextWorkerId = workerId(workerSequence++)
        let task: Task | null
        try {
          task = await runtime.claim(nextWorkerId)
        } catch (error) {
          handleFailure(error)
          break
        }
        if (!task) break
        claimed = true
        idleDelayMs = minimumIdleDelayMs
        let execution: Promise<void>
        execution = runtime.execute(task)
          .catch(handleFailure)
          .finally(() => {
            active.delete(execution)
            wake()
          })
        active.set(execution, nextWorkerId)
      }

      if (lifecycle.signal.aborted) break
      if (claimed && active.size < concurrency) continue
      if (active.size >= concurrency) {
        await waitForWake()
        continue
      }
      await waitForWake(idleDelayMs)
      idleDelayMs = Math.min(maximumIdleDelayMs, idleDelayMs * 2)
    }
  })().catch(failFatally)

  const heartbeat = (async () => {
    while (!lifecycle.signal.aborted) {
      await sleep(heartbeatIntervalMs)
      if (lifecycle.signal.aborted) break
      const workerIds = [...active.values()]
      if (workerIds.length === 0) continue
      try {
        await runtime.heartbeat(workerIds)
      } catch (error) {
        handleFailure(error)
      }
    }
  })().catch(failFatally)

  const done = Promise.allSettled([dispatcher, heartbeat]).then(async () => {
    await Promise.allSettled([...active.keys()])
  })

  return {
    stop() {
      if (!lifecycle.signal.aborted) lifecycle.abort('task_worker_stopped')
      wake()
    },
    done,
    stats: () => ({ active: active.size, idleDelayMs, stopped: lifecycle.signal.aborted }),
  }
}
