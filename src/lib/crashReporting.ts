import crashlytics from '@react-native-firebase/crashlytics';

// Errors that bubble out of event handlers, timers, and unhandled promise
// rejections never reach React's error boundary — they hit ErrorUtils instead.
// Forward them to Crashlytics so they actually get reported in production.
//
// Crashlytics collection is gated to release builds by default (Firebase
// behavior), so calling this in dev is a no-op for the network — but the
// log still appears in the Xcode console for debugging.
export function initCrashReporting() {
  const previousHandler = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
    try {
      crashlytics().log(`globalHandler: isFatal=${isFatal ?? false}`);
      crashlytics().recordError(error);
    } catch {
      // never re-throw from the global handler
    }
    previousHandler?.(error, isFatal);
  });
}

// Report a caught error: surface it in the dev console and forward it to
// Crashlytics so it actually shows up in production. Use instead of bare
// console.error inside catch blocks.
export function reportError(error: unknown, context: string): void {
  const err = error instanceof Error ? error : new Error(String(error));
  if (__DEV__) {
    console.error(`[${context}]`, err);
  }
  try {
    crashlytics().log(context);
    crashlytics().recordError(err);
  } catch {
    // never throw from reporting
  }
}
