import { FontAwesome } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import React from 'react';

export default function AppLayout() {
  return (
    <Tabs>
      <Tabs.Screen
        name="home"
        options={{ title: 'Home', headerShown: false, tabBarIcon: ({ color }) => <FontAwesome name="home" size={28} color={color} /> }}
      />
      <Tabs.Screen
        name="map" // <-- ADD THIS NEW SCREEN
        options={{
          title: 'Map',
          tabBarIcon: ({ color }) => <FontAwesome name="map-marker" size={28} color={color} />,
        }}
      />
       <Tabs.Screen
        name="profile"
        options={{ title: 'Profile', tabBarIcon: ({ color }) => <FontAwesome name="user" size={28} color={color} /> }}
      />
      <Tabs.Screen
        name="wallet"
        options={{ title: 'Wallet', tabBarIcon: ({ color }) => <FontAwesome name="money" size={28} color={color} /> }}
      />
      <Tabs.Screen
        name="history"
        options={{ title: 'History', tabBarIcon: ({ color }) => <FontAwesome name="history" size={28} color={color} /> }}
      />
     
    </Tabs>
  );
}