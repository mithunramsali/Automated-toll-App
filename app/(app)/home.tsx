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
  updateDoc,
  type QueryDocumentSnapshot,
  type QuerySnapshot
} from "firebase/firestore";
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { auth, db } from '../../src/firebaseConfig';

// Type definitions
type Point = { lat: number; lng: number; };
type TollZone = { id: string; name: string; coordinates: Point[]; toll_amount?: number; };

// Helper function to calculate distance (displacement)
const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371e3; // metres
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// Helper function for geofencing
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
  // State Management
  const [userName, setUserName] = useState('');
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [activeZone, setActiveZone] = useState<TollZone | null>(null);
  const [tollZones, setTollZones] = useState<TollZone[]>([]);
  const [loading, setLoading] = useState(true);
  const [entryPoint, setEntryPoint] = useState<Location.LocationObject | null>(null);

  // Refs for advanced logic
  const locationHistoryRef = useRef<Location.LocationObject[]>([]);
  const exitTimerRef = useRef<number | null>(null);

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

  // UPDATED: useEffect for location tracking with Jump Detection
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
          timeInterval: 1000,
          distanceInterval: 5,
        },
        (newLocation) => {
          // --- Start of New Jump Detection & Smoothing Logic ---

          // Check for a large jump in distance
          if (locationHistoryRef.current.length > 0) {
            const lastLocation = locationHistoryRef.current[locationHistoryRef.current.length - 1];
            const jumpDistance = getDistance(
              lastLocation.coords.latitude,
              lastLocation.coords.longitude,
              newLocation.coords.latitude,
              newLocation.coords.longitude
            );

            // If the jump is > 500 meters, clear the history
            if (jumpDistance > 50) {
              locationHistoryRef.current = [];
            }
          }
          
          // Add the new location to our history
          locationHistoryRef.current.push(newLocation);
          
          // Keep the history limited (e.g., to the last 3 points)
          if (locationHistoryRef.current.length > 7) {
            locationHistoryRef.current.shift(); // Removes the oldest point
          }

          // Calculate the average of all points in the current history
          const avgLat = locationHistoryRef.current.reduce((sum, loc) => sum + loc.coords.latitude, 0) / locationHistoryRef.current.length;
          const avgLng = locationHistoryRef.current.reduce((sum, loc) => sum + loc.coords.longitude, 0) / locationHistoryRef.current.length;

          // Create and set the new "smoothed" location
          const smoothedLocation = { ...newLocation, coords: { ...newLocation.coords, latitude: avgLat, longitude: avgLng } };
          
          if (newLocation.coords.accuracy != null && newLocation.coords.accuracy < 75) {
            setLocation(smoothedLocation);
          }

          // --- End of New Logic ---
        }
      );
    };
    startLocationTracking();
    return () => { if (subscriber) { subscriber.remove(); } };
  }, []);

  // Effect to fetch toll zones (from Firestore)
  useEffect(() => {
    const zonesCollectionRef = collection(db, "tollZones");
    const q = query(zonesCollectionRef);
    const unsubscribe = onSnapshot(q, (querySnapshot: QuerySnapshot) => {
      const loadedZones: TollZone[] = [];
      querySnapshot.forEach((doc: QueryDocumentSnapshot) => {
        const data = doc.data();
        const points = data.tollZones || data.coordinates;
        if (data && data.name && points && Array.isArray(points)) {
          loadedZones.push({ id: doc.id, name: data.name, toll_amount: data.toll_amount, coordinates: points });
        }
      });
      setTollZones(loadedZones);
    });
    return () => unsubscribe();
  }, []);

  // Effect for geofencing with grace period
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

    if (currentlyInZone && (!activeZone || currentlyInZone.id === activeZone.id)) {
      if (exitTimerRef.current) {
        clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }
      if (!activeZone) {
        setActiveZone(currentlyInZone);
        setEntryPoint(location);
      }
    } else if (!currentlyInZone && activeZone) {
      if (!exitTimerRef.current) {
        const exitLocation = location;
        const timerId = setTimeout(() => {
          calculateAndChargeToll(entryPoint, exitLocation, activeZone);
          setActiveZone(null);
          setEntryPoint(null);
          exitTimerRef.current = null;
        }, 20000);
        exitTimerRef.current = Number(timerId);
      }
    }
  }, [location, tollZones, activeZone, entryPoint]);

  const calculateAndChargeToll = async (entry: Location.LocationObject | null, exit: Location.LocationObject, zone: TollZone) => {
    if (!entry || !auth.currentUser) return;
    const distanceMeters = getDistance(entry.coords.latitude, entry.coords.longitude, exit.coords.latitude, exit.coords.longitude);
    const ratePerMeter = 50 / 20;
    const calculatedToll = Math.max(0, Math.round(distanceMeters * ratePerMeter));
    if (walletBalance !== null && walletBalance - calculatedToll < 500) {
      Alert.alert("Low Balance", `Toll of ₹${calculatedToll.toFixed(2)} could not be charged.`);
      return;
    }
    const userId = auth.currentUser.uid;
    const userDocRef = doc(db, "users", userId);
    await updateDoc(userDocRef, { walletBalance: increment(-calculatedToll) });
    await addDoc(collection(db, "transactions"), { userId, zoneId: zone.id, zoneName: zone.name, amount: calculatedToll, distance: `${distanceMeters.toFixed(0)}m`, type: 'debit', timestamp: serverTimestamp() });
    Alert.alert("Toll Charged", `You traveled ${distanceMeters.toFixed(0)}m. A toll of ₹${calculatedToll.toFixed(2)} has been deducted.`);
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