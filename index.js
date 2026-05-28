import 'react-native-gesture-handler';
import {AppRegistry} from 'react-native';
import App from './App';
import {name as appName} from './app.json';
import {initCrashReporting} from './src/lib/crashReporting';

initCrashReporting();

AppRegistry.registerComponent(appName, () => App);
