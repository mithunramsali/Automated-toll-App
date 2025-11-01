import { FontAwesome5 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Link } from 'expo-router';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { collection, getDocs, query, where } from 'firebase/firestore';
import React, { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { auth, db } from '../src/firebaseConfig';

const LoginScreen = () => {
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!vehicleNumber || !password) {
      Alert.alert("Error", "Please fill in all fields.");
      return;
    }
    setLoading(true);
    try {
      const usersRef = collection(db, "users");
      const q = query(usersRef, where("vehicleNumber", "==", vehicleNumber.toUpperCase()));
      const querySnapshot = await getDocs(q);

      if (querySnapshot.empty) {
        throw new Error("No user found with this vehicle number.");
      }
      
      const userDoc = querySnapshot.docs[0];
      const userEmail = userDoc.data().email;

      await signInWithEmailAndPassword(auth, userEmail, password);
      // Success, the root layout will navigate automatically
    } catch (error: any) {
      Alert.alert("Login Error", error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <LinearGradient colors={['#111827', '#1f2937']} style={styles.container}>
      <Text style={styles.title}>Welcome Back!</Text>
      <Text style={styles.subtitle}>Sign in to your account</Text>

      <View style={styles.inputContainer}>
        <FontAwesome5 name="car" size={16} color="#9ca3af" style={styles.icon} />
        <TextInput
          style={styles.input}
          placeholder="Vehicle Number"
          placeholderTextColor="#9ca3af"
          value={vehicleNumber}
          onChangeText={setVehicleNumber}
          autoCapitalize="characters"
        />
      </View>

      <View style={styles.inputContainer}>
        <FontAwesome5 name="lock" size={16} color="#9ca3af" style={styles.icon} />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor="#9ca3af"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />
      </View>

      <TouchableOpacity style={styles.button} onPress={handleLogin} disabled={loading}>
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Login</Text>
        )}
      </TouchableOpacity>
      
      <Link href="/register" asChild>
        <TouchableOpacity>
          <Text style={styles.linkText}>Don't have an account? <Text style={styles.linkTextBold}>Register</Text></Text>
        </TouchableOpacity>
      </Link>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 16,
    color: '#9ca3af',
    marginBottom: 40,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1f2937',
    borderRadius: 12,
    width: '100%',
    marginBottom: 15,
    paddingHorizontal: 15,
    borderWidth: 1,
    borderColor: '#374151',
  },
  icon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    height: 50,
    color: '#fff',
  },
  button: {
    width: '100%',
    backgroundColor: '#4338ca',
    padding: 15,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 10,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  linkText: {
    color: '#9ca3af',
    marginTop: 20,
  },
  linkTextBold: {
    fontWeight: 'bold',
    color: '#fff',
  }
});

export default LoginScreen;