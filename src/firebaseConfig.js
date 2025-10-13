import ReactNativeAsyncStorage from '@react-native-async-storage/async-storage';
import { initializeApp } from "firebase/app";
import {
  getReactNativePersistence,
  initializeAuth
} from 'firebase/auth';
import { getDatabase } from "firebase/database";
import { getFirestore } from "firebase/firestore"; // <-- ADD THIS IMPORT

const firebaseConfig = {
  apiKey: "AIzaSyBA7J827tCkWRs4NnKs03fKrlL_Aw7d1_Q",
  authDomain: "my-location-app-c3481.firebaseapp.com",
  databaseURL: "https://my-location-app-c3481-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "my-location-app-c3481",
  storageBucket: "my-location-app-c3481.firebasestorage.app",
  messagingSenderId: "215068074496",
  appId: "1:215068074496:web:82034c64dad231c315aee5"
};
// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Auth with persistence
const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(ReactNativeAsyncStorage)
});

const database = getDatabase(app);
const db = getFirestore(app); // <-- ADD THIS LINE

// Export app and db
export { app, auth, database, db }; // <-- ADD 'db' TO YOUR EXPORTS

