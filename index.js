import 'react-native-gesture-handler';
import {AppRegistry} from 'react-native';
import notifee, {EventType} from '@notifee/react-native';
import App from './App';
import {name as appName} from './app.json';
import {initCrashReporting} from './src/lib/crashReporting';
import {clearDeliveredClientAlarm} from './src/services/alarmDelivery';

initCrashReporting();

notifee.onBackgroundEvent(async ({type, detail}) => {
  if (
    type === EventType.DELIVERED
    || type === EventType.PRESS
    || type === EventType.ACTION_PRESS
  ) {
    await clearDeliveredClientAlarm(detail.notification?.data || {});
  }
});

AppRegistry.registerComponent(appName, () => App);
