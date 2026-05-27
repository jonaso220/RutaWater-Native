import { QueryClient } from '@tanstack/react-query';

// Single QueryClient for the whole app. Defaults tuned for Firestore-backed
// queries that maintain a perpetual realtime listener: data is pushed via
// queryClient.setQueryData from onSnapshot, so refetching on focus/reconnect
// would be redundant and could cause flicker.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,
      gcTime: Infinity,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: false,
    },
  },
});
