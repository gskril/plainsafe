import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { run } from '@/effect/run'
import { loadSettings, saveSettings } from '@/features/settings/store'
import type { Settings } from '@/schemas/settings'
import { keys } from './keys'

export function useSettings() {
  return useQuery({
    queryKey: keys.settings(),
    queryFn: () => run(loadSettings),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  })
}

/** Settings, for components rendered only after the app has loaded them (see app.tsx). */
export function useLoadedSettings(): Settings {
  const { data } = useSettings()
  if (!data) throw new Error('Settings are not loaded yet')
  return data
}

export function useSaveSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (settings: Settings) => {
      await run(saveSettings(settings))
      return settings
    },
    onSuccess: (settings) => queryClient.setQueryData(keys.settings(), settings),
  })
}
