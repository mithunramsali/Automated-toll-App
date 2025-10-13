import { FontAwesome5 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import {
  addDoc,
  collection,
  doc,
  increment,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc
} from "firebase/firestore";
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { auth, db } from '../../src/firebaseConfig';
// Type definitions
type Point = { lat: number; lng: number; };
type TollZone = { id: string; name: string; coordinates: Point[]; toll_amount?: number; };

// Helper function to calculate distance between two coordinates in meters
const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371e3; // metres
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // in metres
};

const isPointInPolygon = (point: Point, polygon: Point[]) => {
  if (!polygon) return false;
  let isInside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].lat, yi = polygon[i].lng;
    const xj = polygon[j].lat, yj = polygon[j].lng;
    const intersect = ((yi > point.lng) !== (yj > point.lng))
      && (point.lat < (xj - xi) * (point.lng - yi) / (yj - yi) + xi);
    if (intersect) isInside = !isInside;
  }
  return isInside;
};

const HomeScreen = () => {
  // State variables are the same
  const [userName, setUserName] = useState('');
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [activeZone, setActiveZone] = useState<TollZone | null>(null);
  const [tollZones, setTollZones] = useState<TollZone[]>([]);
  const [loading, setLoading] = useState(true);
  const [entryPoint, setEntryPoint] = useState<Location.LocationObject | null>(null);
  
  // Use a ref to store the previous location for filtering
  const previousLocationRef = useRef<Location.LocationObject | null>(null);
  // Effect to fetch user data (from Firestore)
  useEffect(() => {
    if (!auth.currentUser) return;
    const userDocRef = doc(db, "users", auth.currentUser.uid);
    const unsubscribe = onSnapshot(userDocRef, (doc) => {
      if (doc.exists()) {
        const data = doc.data();
        setUserName(data.name || '');
        setWalletBalance(data.walletBalance);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Use a ref to store the recent location points for averaging
  const locationHistoryRef = useRef<Location.LocationObject[]>([]);

  // UPDATED: useEffect for location tracking with smoothing
   useEffect(() => {
    let subscriber: Location.LocationSubscription | null = null;
    const startLocationTracking = async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert("Permission Denied", "Location permission is required.");
        return;
      }
      subscriber = await Location.watchPositionAsync(
        { 
          accuracy: Location.Accuracy.BestForNavigation, 
          // This is the fastest setting: check every 1 second
          timeInterval: 1000, 
          distanceInterval: 5,
        },
        (newLocation) => {
          // --- Start of New Smoothing Logic ---
          
          // 1. Add the new location to our history
          locationHistoryRef.current.push(newLocation);
          
          // 2. Keep the history limited to the last 5 points
          if (locationHistoryRef.current.length > 5) {
            locationHistoryRef.current.shift(); // Removes the oldest point
          }

          // 3. Calculate the average of all points in the history
          const avgLat = locationHistoryRef.current.reduce((sum, loc) => sum + loc.coords.latitude, 0) / locationHistoryRef.current.length;
          const avgLng = locationHistoryRef.current.reduce((sum, loc) => sum + loc.coords.longitude, 0) / locationHistoryRef.current.length;

          // 4. Create a new "smoothed" location object
          const smoothedLocation = {
            ...newLocation, // Copy other data like timestamp
            coords: {
              ...newLocation.coords, // Copy other data like accuracy
              latitude: avgLat,
              longitude: avgLng,
            },
          };
          
          // 5. Use the smoothed location to update the app's state
          setLocation(smoothedLocation);

          // --- End of New Smoothing Logic ---
        }
      );
    };
    startLocationTracking();
    return () => { if (subscriber) { subscriber.remove(); } };
  }, []);

  // Effect to fetch toll zones (from firestore Database)
   useEffect(() => {
  const zonesCollectionRef = collection(db, "tollZones");
  const q = query(zonesCollectionRef);

  const unsubscribe = onSnapshot(q, (querySnapshot) => {
    const loadedZones: TollZone[] = [];
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      // This line now checks for 'data.tollZones' OR 'data.coordinates'
      const points = data.tollZones || data.coordinates; 

      if (data && data.name && points && Array.isArray(points)) {
        loadedZones.push({
          id: doc.id,
          name: data.name,
          toll_amount: data.toll_amount,
          coordinates: points 
        });
      } else {
        console.warn(`Skipping malformed toll zone document with ID: ${doc.id}`);
      }
    });
    setTollZones(loadedZones);
  });

  return () => unsubscribe();
}, []);

    // NEW: A ref to hold the 20-second exit timer
    const exitTimerRef = useRef<number | null>(null);

   // UPDATED: Geofencing effect now handles the grace period
  useEffect(() => {
    if (!location || tollZones.length === 0) return;

    const currentLocation: Point = { lat: location.coords.latitude, lng: location.coords.longitude };
    let currentlyInZone: TollZone | null = null;

    for (const zone of tollZones) {
      if (isPointInPolygon(currentLocation, zone.coordinates)) {
        currentlyInZone = zone;
        break;
      }
    }

    // Case 1: Just ENTERED a zone (or re-entered within the grace period)
    if (currentlyInZone && currentlyInZone.id === (activeZone?.id || currentlyInZone.id)) {
      // If an exit timer is running, cancel it because we've re-entered
      if (exitTimerRef.current) {
        clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }
      
      // If this is the first time entering, set the active zone and entry point
      if (!activeZone) {
        setActiveZone(currentlyInZone);
        setEntryPoint(location);
      }
    } 
    // Case 2: Just EXITED a zone
    else if (!currentlyInZone && activeZone) {
      // Don't charge immediately. Start a 20-second timer.
      if (!exitTimerRef.current) {
        const exitLocation = location; // Capture the location at the moment of exit
        exitTimerRef.current = setTimeout(() => {
          // This code will run after 20 seconds IF the timer is not canceled
          calculateAndChargeToll(entryPoint, exitLocation, activeZone);
          setActiveZone(null);
          setEntryPoint(null);
          exitTimerRef.current = null; // Clear the timer ref
        }, 20000); // 20000 milliseconds = 20 seconds
      }
    }
  }, [location, tollZones, activeZone, entryPoint]);

  const calculateAndChargeToll = async (entry: Location.LocationObject | null, exit: Location.LocationObject, zone: TollZone) => {
    if (!entry || !auth.currentUser) return;
    const distanceMeters = getDistance(entry.coords.latitude, entry.coords.longitude, exit.coords.latitude, exit.coords.longitude);
    const ratePerMeter = 50 / 20; // Your rule: ₹50 per 20 meters
    const calculatedToll = Math.max(0, Math.round(distanceMeters * ratePerMeter)); // Ensure toll is not negative
    if (walletBalance !== null && walletBalance - calculatedToll < 500) {
      Alert.alert("Low Balance on Exit", `Toll of ₹${calculatedToll.toFixed(2)} could not be charged. Please add funds.`);
      return;
    }
    const userId = auth.currentUser.uid;
    const userDocRef = doc(db, "users", userId);
    await updateDoc(userDocRef, { walletBalance: increment(-calculatedToll) });
    await addDoc(collection(db, "transactions"), {
      userId,
      zoneId: zone.id,
      zoneName: zone.name,
      amount: calculatedToll,
      distance: `${distanceMeters.toFixed(0)} meters`,
      type: 'debit',
      timestamp: serverTimestamp()
    });
    Alert.alert("Toll Charged", `You traveled ${distanceMeters.toFixed(0)}m in ${zone.name}. A toll of ₹${calculatedToll.toFixed(2)} has been deducted.`);
  };

  if (loading) {
    return <ActivityIndicator size="large" style={styles.loader} />;
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.greeting}>Hello,</Text>
        <Text style={styles.userName}>{userName || 'User'}</Text>
      </View>
      <View style={styles.infoContainer}>
        <View style={styles.infoBox}>
           <FontAwesome5 name="wallet" size={20} color="#8f94fb" style={styles.infoIcon} />
           <View>
             <Text style={styles.infoLabel}>Wallet Balance</Text>
             <Text style={styles.infoValue}>₹{walletBalance?.toFixed(2) || '0.00'}</Text>
           </View>
        </View>
        <View style={styles.infoBox}>
          <FontAwesome5 name="map-marker-alt" size={20} color="#666" style={styles.infoIcon} />
           <View>
             <Text style={styles.infoLabel}>GPS Status</Text>
             <Text style={styles.infoValue}>{location ? 'Connected' : 'Searching...'}</Text>
           </View>
        </View>
      </View>
      <LinearGradient
        colors={activeZone ? ['#FFD166', '#FFB703'] : ['#4DDE9B', '#34A853']}
        style={styles.statusCard}
      >
        {activeZone ? (
          <>
            <FontAwesome5 name="exclamation-circle" style={styles.icon} color="#fff" />
            <Text style={styles.title}>Entering Zone</Text>
            <Text style={styles.zoneName}>{activeZone.name}</Text>
          </>
        ) : (
          <>
            <FontAwesome5 name="check-circle" style={styles.icon} color="#fff" />
            <Text style={styles.title}>All Clear</Text>
            <Text style={styles.subtitle}>You are not in a toll zone.</Text>
          </>
        )}
      </LinearGradient>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f2f5', padding: 20 },
  loader: { flex: 1, justifyContent: 'center', backgroundColor: '#f0f2f5' },
  header: { marginTop: 50, marginBottom: 20 },
  greeting: { fontSize: 22, color: '#888' },
  userName: { fontSize: 34, fontWeight: '700', color: '#222' },
  infoContainer: { flexDirection: 'row', justifyContent: 'space-around', backgroundColor: '#fff', borderRadius: 20, paddingVertical: 20, marginBottom: 25, shadowColor: '#000', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.08, shadowRadius: 15, elevation: 5 },
  infoBox: { flexDirection: 'row', alignItems: 'center' },
  infoIcon: { marginRight: 10 },
  infoLabel: { fontSize: 14, color: 'gray' },
  infoValue: { fontSize: 18, fontWeight: '600', color: '#222' },
  statusCard: { flex: 1, width: '100%', justifyContent: 'center', alignItems: 'center', borderRadius: 30, padding: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.1, shadowRadius: 20, elevation: 5 },
  icon: { fontSize: 60, marginBottom: 15, textShadowColor: 'rgba(0, 0, 0, 0.15)', textShadowOffset: { width: 0, height: 4 }, textShadowRadius: 10 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#fff' },
  subtitle: { fontSize: 18, color: 'rgba(255, 255, 255, 0.9)', marginTop: 8 },
  zoneName: { fontSize: 22, fontWeight: '600', textAlign: 'center', color: '#fff', marginTop: 8 },
});

export default HomeScreen;