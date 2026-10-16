import 'react-native-gesture-handler';
import {AppRegistry} from 'react-native';
import notifee, {EventType} from '@notifee/react-native';
import App from './App';
import {name as appName} from './app.json';
import {initCrashReporting} from './src/lib/crashReporting';
import {clearDeliveredClientAlarm} from './src/services/alarmDelivery';
import {
  registerLiveTrackingService,
  STOP_TRACKING_ACTION,
  stopLiveTracking,
} from './src/services/liveTracking';

initCrashReporting();
registerLiveTrackingService();

// «Dejar de compartir» en la notificación del seguimiento en vivo (Android).
const handleTrackingAction = ({type, detail}) => {
  if (type === EventType.ACTION_PRESS && detail.pressAction?.id === STOP_TRACKING_ACTION) {
    stopLiveTracking();
    return true;
  }
  return false;
};
notifee.onForegroundEvent(handleTrackingAction);

notifee.onBackgroundEvent(async ({type, detail}) => {
  if (handleTrackingAction({type, detail})) return;
  if (
    type === EventType.DELIVERED
    || type === EventType.PRESS
    || type === EventType.ACTION_PRESS
  ) {
    await clearDeliveredClientAlarm(detail.notification?.data || {});
  }
});

AppRegistry.registerComponent(appName, () => App);
