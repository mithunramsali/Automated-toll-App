import { FontAwesome5 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { addDoc, collection, doc, increment, limit, onSnapshot, orderBy, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { auth, db } from '../../src/firebaseConfig';

type Transaction = {
  id: string;
  zoneName?: string;
  description?: string;
  amount: number;
  type: 'credit' | 'debit';
  timestamp: { toDate: () => Date; };
};

const WalletScreen = () => {
  const [userName, setUserName] = useState('');
  const [balance, setBalance] = useState<number | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (auth.currentUser) {
      const userId = auth.currentUser.uid;
      const userDocRef = doc(db, "users", userId);
      const unsubscribeBalance = onSnapshot(userDocRef, (doc) => {
        if (doc.exists()) {
          const data = doc.data();
          setUserName(data.name || 'Card Holder');
          setBalance(data.walletBalance);
        }
        setLoading(false);
      });

      const transColRef = collection(db, "transactions");
      const q = query(transColRef, where("userId", "==", userId), orderBy("timestamp", "desc"), limit(5));
      const unsubscribeTransactions = onSnapshot(q, (snapshot) => {
        setTransactions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Transaction[]);
      });

      return () => { unsubscribeBalance(); unsubscribeTransactions(); };
    }
  }, []);

  const handleAddFunds = async (amount: number) => {
    if (auth.currentUser) {
      const userId = auth.currentUser.uid;
      const userDocRef = doc(db, "users", userId);
      await updateDoc(userDocRef, { walletBalance: increment(amount) });
      await addDoc(collection(db, "transactions"), {
        userId,
        amount,
        type: 'credit',
        description: 'Wallet Top-up',
        timestamp: serverTimestamp()
      });
      Alert.alert("Success", `₹${amount} has been added to your wallet.`);
    }
  };

  const renderTransactionItem = ({ item }: { item: Transaction }) => (
    <View style={styles.itemContainer}>
      <View style={[styles.itemIcon, { backgroundColor: item.type === 'credit' ? 'rgba(52, 211, 153, 0.1)' : '#374151' }]}>
        <FontAwesome5 name={item.type === 'credit' ? "plus" : "road"} size={18} color={item.type === 'credit' ? '#10b981' : '#9ca3af'} />
      </View>
      <View style={styles.itemDetails}>
        <Text style={styles.itemZone}>{item.description || item.zoneName}</Text>
        {/* --- THIS IS THE UPDATED LINE --- */}
        <Text style={styles.itemDate}>{item.timestamp ? item.timestamp.toDate().toLocaleString() : ''}</Text>
      </View>
      <Text style={[styles.itemAmount, { color: item.type === 'credit' ? '#10b981' : '#f87171' }]}>
        {item.type === 'credit' ? '+' : '-'} ₹{item.amount.toFixed(2)}
      </Text>
    </View>
  );

  if (loading) {
    return <ActivityIndicator size="large" style={styles.loader} />;
  }

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.headerTitle}>My Wallet</Text>
      <LinearGradient colors={['#4338ca', '#6366f1']} style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardLabel}>Available Balance</Text>
          <FontAwesome5 name="wifi" size={20} color="rgba(255, 255, 255, 0.7)" style={{ transform: [{ rotate: '90deg' }] }} />
        </View>
        <Text style={styles.cardBalance}>₹{balance?.toFixed(2)}</Text>
        <View style={styles.cardFooter}>
          <Text style={styles.cardHolderName}>{userName}</Text>
          <Text style={styles.cardLogo}>TOLL PAY</Text>
        </View>
      </LinearGradient>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Quick Top-up</Text>
        <View style={styles.buttonsRow}>
          <TouchableOpacity style={styles.topUpChip} onPress={() => handleAddFunds(500)}><Text style={styles.topUpText}>+ ₹500</Text></TouchableOpacity>
          <TouchableOpacity style={styles.topUpChip} onPress={() => handleAddFunds(1000)}><Text style={styles.topUpText}>+ ₹1000</Text></TouchableOpacity>
          <TouchableOpacity style={styles.topUpChip} onPress={() => handleAddFunds(2000)}><Text style={styles.topUpText}>+ ₹2000</Text></TouchableOpacity>
        </View>
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Recent Activity</Text>
        <FlatList data={transactions} scrollEnabled={false} renderItem={renderTransactionItem} keyExtractor={item => item.id} ListEmptyComponent={() => (<View style={styles.emptyListContainer}><Text style={styles.emptyListText}>No recent transactions.</Text></View>)} />
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#111827', paddingTop: 60, paddingHorizontal: 20 },
    loader: { flex: 1, justifyContent: 'center', backgroundColor: '#111827' },
    headerTitle: { fontSize: 28, fontWeight: 'bold', color: '#fff', marginBottom: 20 },
    card: { padding: 25, borderRadius: 20, marginBottom: 30, height: 200, justifyContent: 'space-between' },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    cardLabel: { fontSize: 16, color: 'rgba(255, 255, 255, 0.7)' },
    cardBalance: { fontSize: 40, fontWeight: 'bold', color: '#fff' },
    cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
    cardHolderName: { fontSize: 16, color: 'rgba(255, 255, 255, 0.9)' },
    cardLogo: { fontSize: 18, fontWeight: 'bold', fontStyle: 'italic', color: '#fff' },
    section: { width: '100%', marginBottom: 20 },
    sectionTitle: { fontSize: 18, fontWeight: '600', marginBottom: 15, color: '#9ca3af' },
    buttonsRow: { flexDirection: 'row', justifyContent: 'space-between' },
    topUpChip: { backgroundColor: '#1f2937', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 10, borderWidth: 1, borderColor: '#374151' },
    topUpText: { fontSize: 14, fontWeight: '600', color: '#e5e7eb' },
    itemContainer: { flexDirection: 'row', alignItems: 'center', padding: 15, backgroundColor: '#1f2937', borderRadius: 12, marginBottom: 10 },
    itemIcon: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
    itemDetails: { flex: 1, marginLeft: 15 },
    itemZone: { fontSize: 16, fontWeight: '500', color: '#fff' },
    itemDate: { fontSize: 12, color: '#9ca3af', marginTop: 2 },
    itemAmount: { fontSize: 16, fontWeight: 'bold' },
    emptyListContainer: { alignItems: 'center', padding: 20 },
    emptyListText: { fontSize: 14, color: '#6b7280' },
});

export default WalletScreen;