/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { PGlite } from "@electric-sql/pglite";

// Configuration interface
interface DatabaseConfig {
  wasmPath: string;
  fsBundlePath: string;
  maxQueueSize: number;
  databaseName: string;
  channelName: string;
}

// Default configuration
const DEFAULT_CONFIG: DatabaseConfig = {
  wasmPath: '/pglite.wasm',
  fsBundlePath: '/pglite.data',
  maxQueueSize: 100,
  databaseName: "idb://patient_db",
  channelName: "patient_data_channel"
};

// Database state
let dbInstance: PGlite | null = null;
let dbChannel: BroadcastChannel | null = null;
let isInitialized = false;

// Transaction queue management
let isTransactionInProgress = false;
let pendingTransactions: Array<() => Promise<void>> = [];
let connectionCheckInterval: NodeJS.Timeout;

// Track initialization state in localStorage for multi-tab consistency
const DB_INIT_KEY = "patient_db_initialized";

async function checkConnection() {
  if (!dbInstance) return false;
  try {
    await dbInstance.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

/**
 * Initialize the database connection with optional configuration
 */
async function initializeDatabase(config: Partial<DatabaseConfig> = {}): Promise<PGlite> {
  if (isInitialized && dbInstance) {
    return dbInstance;
  }

  const fullConfig: DatabaseConfig = { ...DEFAULT_CONFIG, ...config };

  try {
    console.log("Initializing database connection...");
    
    // First check if another tab has already initialized the database
    const isInitializedInOtherTab = localStorage.getItem(DB_INIT_KEY) === "true";
    console.log("Database initialized in other tab:", isInitializedInOtherTab);

    // Fetch resources in parallel
    const [wasmResponse, fsResponse] = await Promise.all([
      fetch(fullConfig.wasmPath),
      fetch(fullConfig.fsBundlePath)
    ]);

    if (!wasmResponse.ok) {
      throw new Error(`Failed to fetch WASM: ${wasmResponse.status} ${wasmResponse.statusText}`);
    }
    if (!fsResponse.ok) {
      throw new Error(`Failed to fetch FS bundle: ${fsResponse.status} ${fsResponse.statusText}`);
    }

    const [wasmModule, fsBundle] = await Promise.all([
      WebAssembly.compileStreaming(wasmResponse),
      fsResponse.blob()
    ]);

    // Initialize database with local assets
    dbInstance = await PGlite.create({
      wasmModule,
      fsBundle,
      dataDir: fullConfig.databaseName,
      persist: true,
      syncToStorage: true, // Force synchronous writes to IndexedDB
    });
    
    // Verify database connection
    await dbInstance.query("SELECT 1");
    console.log("Database connection established");
    
    // Mark as initialized in localStorage for other tabs
    localStorage.setItem(DB_INIT_KEY, "true");
    
    // Initialize broadcast channel with explicit error handling
    try {
      dbChannel = new BroadcastChannel(fullConfig.channelName);
      console.log("Broadcast channel established");
      
      // Send a ping to let other tabs know we're online
      dbChannel.postMessage({
        type: "tab_online",
        timestamp: Date.now(),
        tabId: generateTabId(),
      });
    } catch (channelError) {
      console.error("Failed to create broadcast channel:", channelError);
      // Continue without channel if it fails
    }
    
    isInitialized = true;
    console.log("Database fully initialized");
    
    // Set up connection health check
    connectionCheckInterval = setInterval(async () => {
      const isAlive = await checkConnection();
      if (!isAlive) {
        console.warn("Database connection lost, reinitializing...");
        await cleanupDatabase();
        await initializeDatabase(config);
      }
    }, 5000);
    
    // Listen for storage events (fallback sync mechanism)
    window.addEventListener('storage', handleStorageEvent);
    
    return dbInstance;
  } catch (error) {
    console.error("Database initialization error:", error);
    // Clean up if initialization fails
    await cleanupDatabase();
    throw error;
  }
}

// Generate a unique ID for this tab
function generateTabId(): string {
  return `tab_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

// Handle localStorage events (fallback sync mechanism)
function handleStorageEvent(event: StorageEvent) {
  if (event.key === 'db_change_notification') {
    console.log("Received database change via localStorage");
    // Force a refresh of the data
    window.dispatchEvent(new CustomEvent('force-data-refresh'));
  }
}

// Export the initialization promise
export const dbPromise = initializeDatabase();

// Initialize patient table with explicit error handling
export async function initializePatientTable() {
  try {
    console.log("Creating patients table if not exists...");
    await executeQuery(`
      CREATE TABLE IF NOT EXISTS patients (
        id SERIAL PRIMARY KEY,
        full_name TEXT NOT NULL,
        age INTEGER NOT NULL,
        gender TEXT NOT NULL,
        contact_info TEXT,
        address TEXT,
        email TEXT,
        blood_type TEXT,
        allergies TEXT,
        medical_history TEXT,
        insurance_provider TEXT,
        insurance_id TEXT,
        emergency_contact TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Verify table exists by querying structure
    const tableCheck = await executeQuery(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'patients'
    `);
    console.log("Patients table verified with columns:", tableCheck.rows?.length || 0);
    
    // Create index for better performance
    await executeQuery(`
      CREATE INDEX IF NOT EXISTS idx_patients_created_at ON patients(created_at DESC)
    `);
    
    return true;
  } catch (error) {
    console.error("Error initializing patients table:", error);
    return false;
  }
}

/**
 * Clean up database resources
 */
export async function cleanupDatabase(): Promise<void> {
  clearInterval(connectionCheckInterval);
  window.removeEventListener('storage', handleStorageEvent);
  
  if (dbInstance) {
    try {
      await dbInstance.close();
    } catch (err) {
      console.error("Error closing database:", err);
    }
    dbInstance = null;
  }
  
  if (dbChannel) {
    try {
      dbChannel.close();
    } catch (err) {
      console.error("Error closing broadcast channel:", err);
    }
    dbChannel = null;
  }
  
  isInitialized = false;
  pendingTransactions = [];
  console.log("Database resources cleaned up");
}

/**
 * Process pending database transactions
 */
async function processPendingTransactions(): Promise<void> {
  if (pendingTransactions.length === 0 || isTransactionInProgress) {
    return;
  }

  isTransactionInProgress = true;
  const transaction = pendingTransactions.shift();

  if (transaction) {
    try {
      await transaction();
    } catch (error) {
      console.error("Transaction processing error:", error);
    } finally {
      isTransactionInProgress = false;
      // Process next transaction in the next event loop iteration
      setTimeout(processPendingTransactions, 0);
    }
  }
}

/**
 * Check if a query modifies the database
 */
function isModifyingQuery(query: string): boolean {
  const lowerQuery = query.toLowerCase().trim();
  return (
    lowerQuery.startsWith("insert") ||
    lowerQuery.startsWith("update") ||
    lowerQuery.startsWith("delete") ||
    lowerQuery.startsWith("create") ||
    lowerQuery.startsWith("alter") ||
    lowerQuery.startsWith("drop") ||
    lowerQuery.startsWith("truncate")
  );
}

/**
 * Execute an SQL query with transaction queuing and improved error handling
 */
export async function executeQuery<T = any>(
  query: string,
  params: unknown[] = [],
  config?: { skipQueue?: boolean; retries?: number; broadcastTable?: string }
): Promise<T> {
  const retries = config?.retries ?? 3;
  let lastError: Error | null = null;
  
  // Validate database initialization
  if (!isInitialized) {
    try {
      console.log("Database not initialized, initializing now...");
      await dbPromise;
    } catch (error) {
      throw new Error(`Failed to initialize database: ${error.message}`);
    }
  }

  // Skip queue for read-only queries if requested
  if (config?.skipQueue && !isModifyingQuery(query)) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const db = await dbPromise;
        return await db.query(query, params) as T;
      } catch (error) {
        console.warn(`Query attempt ${attempt}/${retries} failed:`, error);
        lastError = error;
        
        if (attempt < retries) {
          // Wait before retrying (exponential backoff)
          await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, attempt - 1)));
        }
      }
    }
    throw lastError || new Error("Query failed after retries");
  }

   return new Promise((resolve, reject) => {
    pendingTransactions.push(async () => {
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          const db = await dbPromise;
          const result = await db.query(query, params);
          
          if (isModifyingQuery(query)) {
            broadcastDatabaseChange(query, config?.broadcastTable);
          }
          
          resolve(result as T);
          return;
        } catch (error) {
          console.warn(`Query attempt ${attempt}/${retries} failed:`, error);
          lastError = error;
          
          if (attempt < retries) {
            // Wait before retrying (exponential backoff)
            await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, attempt - 1)));
          } else {
            reject(error);
          }
        }
      }
    });
    
    // Start processing the queue
    processPendingTransactions();
  });
}

/**
 * Broadcast database changes through multiple channels for redundancy
 */
function broadcastDatabaseChange(query: string, affectedTable?: string): void {
  const changeInfo = {
    type: "data_updated",
    action: getQueryAction(query),
    query,
    affectedTable: affectedTable || getAffectedTable(query),
    timestamp: Date.now(),
    origin: window.location.href,
    tabId: generateTabId(),
  };
  
  try {
    // Method 1: BroadcastChannel API
    if (dbChannel) {
      console.log("Broadcasting update via channel:", changeInfo);
      dbChannel.postMessage(changeInfo);
    }
    
    // Method 2: localStorage event (fallback)
    const notificationKey = `db_change_notification`;
    localStorage.setItem(notificationKey, JSON.stringify({
      ...changeInfo,
      timestamp: Date.now(),
    }));
    
    // Method 3: Custom event within same window
    window.dispatchEvent(new CustomEvent('database-changed', { 
      detail: changeInfo 
    }));
  } catch (error) {
    console.error("Error broadcasting change:", error);
  }
}

/**
 * Get the action type from a query
 */
function getQueryAction(query: string): string {
  const lowerQuery = query.toLowerCase().trim();
  if (lowerQuery.startsWith("insert")) return "insert";
  if (lowerQuery.startsWith("update")) return "update";
  if (lowerQuery.startsWith("delete")) return "delete";
  if (lowerQuery.startsWith("create")) return "create";
  if (lowerQuery.startsWith("alter")) return "alter";
  if (lowerQuery.startsWith("drop")) return "drop";
  if (lowerQuery.startsWith("truncate")) return "truncate";
  return "other";
}

/**
 * Listen for database updates with improved reliability
 */
export function onDatabaseUpdate(
  callback: (event: { type: string; action: string; query: string; timestamp: number }) => void
): () => void {
  const listeners: Array<() => void> = [];
  
  // Method 1: Listen via BroadcastChannel
  if (dbChannel) {
    const channelListener = (event: MessageEvent) => {
      if (event.data && (event.data.type === "data_updated" || event.data.type === "tab_online")) {
        console.log("Received broadcast channel message:", event.data);
        callback(event.data);
      }
    };
    
    dbChannel.addEventListener("message", channelListener);
    listeners.push(() => dbChannel?.removeEventListener("message", channelListener));
  }
  
  // Method 2: Listen via storage events (works across tabs)
  const storageListener = (event: StorageEvent) => {
    if (event.key === 'db_change_notification' && event.newValue) {
      try {
        const data = JSON.parse(event.newValue);
        console.log("Received localStorage change notification:", data);
        callback(data);
      } catch (error) {
        console.error("Error parsing storage event data:", error);
      }
    }
  };
  
  window.addEventListener('storage', storageListener);
  listeners.push(() => window.removeEventListener('storage', storageListener));
  
  // Method 3: Listen via custom events (within same window)
  const customEventListener = (event: Event) => {
    const customEvent = event as CustomEvent;
    if (customEvent.detail) {
      console.log("Received custom event:", customEvent.detail);
      callback(customEvent.detail);
    }
  };
  
  window.addEventListener('database-changed', customEventListener);
  listeners.push(() => window.removeEventListener('database-changed', customEventListener));
  
  // Method 4: Listen for forced refresh events
  const refreshListener = () => {
    console.log("Forced data refresh requested");
    callback({
      type: "data_updated",
      action: "refresh",
      query: "",
      timestamp: Date.now()
    });
  };
  
  window.addEventListener('force-data-refresh', refreshListener);
  listeners.push(() => window.removeEventListener('force-data-refresh', refreshListener));
  
  // Return a combined cleanup function
  return () => {
    listeners.forEach(cleanup => cleanup());
  };
}

//helper functions
function getAffectedTable(query: string): string | null {
  const lowerQuery = query.toLowerCase();
  const tableMatch = lowerQuery.match(/from\s+([^\s,;)]+)|into\s+([^\s,;)]+)|update\s+([^\s,;)]+)/i);
  return tableMatch ? (tableMatch[1] || tableMatch[2] || tableMatch[3]) : null;
}