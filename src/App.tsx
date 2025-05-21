import { useEffect, useCallback, useState, useRef } from "react";
import PatientRegistrationForm from "./components/PatientRegistrationForm";
import QueryExecutor from "./components/QueryExecutor";
import { initializePatientTable, onDatabaseUpdate } from "./utils/pgliteConfig";

function App() {
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [isDbInitialized, setIsDbInitialized] = useState(false);
  const updateListenerRef = useRef<(() => void) | null>(null);
  const initAttempts = useRef(0);
  const maxInitAttempts = 3;

  const initialize = useCallback(async () => {
    try {
      console.log("Starting database initialization...");
      console.log("Database instance ready");

      await initializePatientTable();
      console.log("Patient table initialized");

      setIsDbInitialized(true);

      console.log("Database fully initialized and ready");

      setRefreshTrigger((prev) => prev + 1);
    } catch (error) {
      console.error("Initialization failed:", error);

      initAttempts.current++;
      if (initAttempts.current < maxInitAttempts) {
        console.log(
          `Retrying initialization (attempt ${
            initAttempts.current + 1
          }/${maxInitAttempts})...`
        );
        setTimeout(initialize, 1000);
      } else {
        setIsDbInitialized(false);
      }
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      try {
        await initialize();
      } catch (error) {
        console.error("Initialization error:", error);
        if (mounted) {
          setIsDbInitialized(false);
        }
      }
    };

    init();

    return () => {
      mounted = false;
    };
  }, [initialize]);

  useEffect(() => {
    if (!isDbInitialized) return;

    if (updateListenerRef.current) {
      updateListenerRef.current();
      updateListenerRef.current = null;
    }

    try {
      const unsubscribe = onDatabaseUpdate((event) => {
        console.log("App received database update:", event);
        setRefreshTrigger((prev) => prev + 1);
      });

      updateListenerRef.current = unsubscribe;

      return () => {
        if (updateListenerRef.current) {
          updateListenerRef.current();
          updateListenerRef.current = null;
        }
      };
    } catch (error) {
      console.error("Error setting up database update listener:", error);
    }
  }, [isDbInitialized]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl md:text-4xl font-bold text-gray-900">
            Patient Registration App
          </h1>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <PatientRegistrationForm
            onPatientAdded={() => setRefreshTrigger((prev) => prev + 1)}
          />
          <QueryExecutor
            refreshTrigger={refreshTrigger}
            isDbInitialized={isDbInitialized}
          />
        </div>
      </div>
    </div>
  );
}

export default App;
