// The app's one ManagedRuntime (SPEC §9.2). Query hooks call runtime.runPromise(program).
import { ManagedRuntime } from 'effect'
import { StorageLive } from '@/storage/service'

export const runtime = ManagedRuntime.make(StorageLive)
