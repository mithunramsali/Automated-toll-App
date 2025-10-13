import * as Location from 'expo-location';
import { collection, onSnapshot, query } from "firebase/firestore";
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import MapView, { Polygon } from 'react-native-maps';
import { db } from '../../src/firebaseConfig';

type Point = { lat: number; lng: number; };
type TollZone = { id: string; name: string; coordinates: Point[]; };

const MapScreen = () => {
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [tollZones, setTollZones] = useState<TollZone[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const setupMap = async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        console.error("Permission to access location was denied");
        setLoading(false);
        return;
      }
      const initialLocation = await Location.getCurrentPositionAsync({});
      setLocation(initialLocation);
      
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
              coordinates: points
            });
          } else {
            console.warn(`Skipping malformed toll zone document with ID: ${doc.id}`);
          }
        });
        setTollZones(loadedZones);
        setLoading(false);
      });

      // Cleanup the listener when the component unmounts
      return () => unsubscribe();
    };
    setupMap();
  }, []);

  if (loading) {
    return <ActivityIndicator size="large" style={styles.loader} />;
  }

  return (
    <View style={styles.container}>
      {location && (
        <MapView
          style={styles.map}
          initialRegion={{
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            latitudeDelta: 0.0922,
            longitudeDelta: 0.0421,
          }}
          showsUserLocation={true}
        >
          {tollZones.map(zone => {
            // Safety Check: Don't try to draw a polygon if coordinates are missing
            if (!zone.coordinates || zone.coordinates.length === 0) {
              return null;
            }
            return (
              <Polygon
                key={zone.id}
                coordinates={zone.coordinates.map(p => ({ latitude: p.lat, longitude: p.lng }))}
                strokeColor="rgba(255, 0, 0, 0.8)"
                fillColor="rgba(255, 0, 0, 0.2)"
                strokeWidth={2}
              />
            );
          })}
        </MapView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { width: '100%', height: '100%' },
  loader: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});

export default MapScreen;