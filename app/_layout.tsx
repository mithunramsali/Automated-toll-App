import { router, Stack, useRootNavigationState } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { onAuthStateChanged, User } from 'firebase/auth';
import React, { useEffect, useState } from 'react';
import { auth } from '../src/firebaseConfig';

// Prevent the splash screen from auto-hiding before we are ready.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const rootNavigationState = useRootNavigationState();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoaded(true); // Mark auth as loaded after the first check
    });
    return () => unsubscribe(); // Cleanup on unmount
  }, []);

  useEffect(() => {
    // Wait for both authentication to load and navigation to be ready
    if (!authLoaded || !rootNavigationState?.key) {
      return;
    }

    // Now that we are ready, hide the splash screen
    SplashScreen.hideAsync();

    if (user) {
      // If user is logged in, go to the home screen
      router.replace('/(app)/home');
    } else {
      // If user is logged out, go to the login screen
      router.replace('/');
    }
  }, [authLoaded, user, rootNavigationState?.key]);

  // Return null or a loading indicator while we are loading
  if (!authLoaded || !rootNavigationState?.key) {
    return null;
  }

  // Render the actual navigator
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="register" />
      <Stack.Screen name="(app)" />
    </Stack>
  );
}