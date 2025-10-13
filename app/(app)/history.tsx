import { FontAwesome5 } from '@expo/vector-icons';
import { format, isToday, isYesterday } from 'date-fns';
import { collection, doc, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, SectionList, StyleSheet, Text, View } from 'react-native';
import { auth, db } from '../../src/firebaseConfig';

type Transaction = {
  id: string;
  zoneName: string;
  amount: number;
  // Timestamp can be null temporarily
  timestamp: { toDate: () => Date; } | null; 
};

type SectionData = {
  title: string;
  data: Transaction[];
};

const groupTransactionsByDate = (transactions: Transaction[]): SectionData[] => {
  if (transactions.length === 0) return [];
  
  const groups = transactions.reduce((acc, transaction) => {
    // --- THIS IS THE SAFETY CHECK ---
    // If the timestamp doesn't exist yet, skip this transaction for now.
    if (!transaction.timestamp) {
      return acc;
    }

    const date = transaction.timestamp.toDate();
    let title = '';
    
    if (isToday(date)) title = 'Today';
    else if (isYesterday(date)) title = 'Yesterday';
    else title = format(date, 'MMMM d, yyyy');

    if (!acc[title]) acc[title] = [];
    acc[title].push(transaction);
    return acc;
  }, {} as { [key: string]: Transaction[] });

  return Object.keys(groups).map(title => ({
    title,
    data: groups[title]
  }));
};

const HistoryScreen = () => {
  // The rest of your component logic remains the same
  const [sections, setSections] = useState<SectionData[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (auth.currentUser) {
      const userId = auth.currentUser.uid;

      // New listener to get the current wallet balance in real-time
      const userDocRef = doc(db, "users", userId);
      const unsubscribeBalance = onSnapshot(userDocRef, (doc) => {
        if (doc.exists()) {
          setBalance(doc.data().walletBalance);
        }
      });
      
      // Updated query to only fetch 'debit' transactions
      const transColRef = collection(db, "transactions");
      const q = query(
        transColRef, 
        where("userId", "==", userId),
        where("type", "==", "debit"), // <-- This only gets toll deductions
        orderBy("timestamp", "desc")
      );

      const unsubscribeTransactions = onSnapshot(q, (querySnapshot) => {
        const loadedTransactions = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Transaction[];
        const groupedData = groupTransactionsByDate(loadedTransactions);
        setSections(groupedData);
        setLoading(false);
      });

      // Cleanup both listeners
      return () => {
        unsubscribeBalance();
        unsubscribeTransactions();
      };
    }
  }, []);

  const renderItem = ({ item }: { item: Transaction }) => (
    <View style={styles.itemContainer}>
      <View style={styles.itemIcon}><FontAwesome5 name="road" size={18} color="#9ca3af" /></View>
      <View style={styles.itemDetails}>
        <Text style={styles.itemZone}>{item.zoneName}</Text>
       <Text style={styles.itemDate}>{item.timestamp ? item.timestamp.toDate().toLocaleString() : ''}</Text>
      </View>
      <Text style={styles.itemAmount}>- ₹{item.amount.toFixed(2)}</Text>
    </View>
  );
  
  const renderSectionHeader = ({ section: { title } }: { section: SectionData }) => (
    <Text style={styles.sectionHeader}>{title}</Text>
  );

  if (loading) {
    return <ActivityIndicator size="large" style={styles.loader} />;
  }

  return (
    <View style={styles.container}>
      {/* New Header to display current balance */}
      <View style={styles.balanceHeader}>
        <Text style={styles.balanceLabel}>Current Balance</Text>
        <Text style={styles.balanceText}>₹{balance?.toFixed(2) || '0.00'}</Text>
      </View>

      {sections.length > 0 ? (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          renderSectionHeader={renderSectionHeader}
          contentContainerStyle={styles.list}
        />
      ) : (
        <View style={styles.emptyContainer}>
          <FontAwesome5 name="history" size={40} color="#4b5563" />
          <Text style={styles.emptyText}>No Toll History</Text>
          <Text style={styles.emptySubText}>Your past toll payments will appear here.</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111827' },
  loader: { flex: 1, justifyContent: 'center', backgroundColor: '#111827' },
  balanceHeader: {
    padding: 20,
    paddingTop: 60,
    alignItems: 'center',
    backgroundColor: '#1f2937',
    borderBottomWidth: 1,
    borderBottomColor: '#374151',
  },
  balanceLabel: { fontSize: 16, color: '#9ca3af' },
  balanceText: { fontSize: 32, fontWeight: 'bold', color: '#fff' },
  list: { paddingHorizontal: 20, paddingBottom: 40 },
  sectionHeader: { fontSize: 16, fontWeight: '600', color: '#9ca3af', paddingVertical: 15, marginTop: 10, textTransform: 'uppercase' },
  itemContainer: { flexDirection: 'row', alignItems: 'center', padding: 15, backgroundColor: '#1f2937', borderRadius: 12, marginBottom: 10 },
  itemIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#374151', justifyContent: 'center', alignItems: 'center' },
  itemDetails: { flex: 1, marginLeft: 15 },
  itemZone: { fontSize: 16, fontWeight: '500', color: '#fff' },
  itemDate: { fontSize: 12, color: '#9ca3af', marginTop: 2 },
  itemAmount: { fontSize: 16, fontWeight: 'bold', color: '#f87171' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { fontSize: 18, fontWeight: 'bold', color: '#d1d5db', marginTop: 15 },
  emptySubText: { fontSize: 14, color: '#6b7280', marginTop: 5 },
});

export default HistoryScreen;