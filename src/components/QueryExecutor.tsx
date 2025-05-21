import { useState, useEffect, useCallback, useRef } from "react";
import clsx from "clsx";
import PatientTable from "./PatientTable";
import { executeQuery, onDatabaseUpdate } from "../utils/pgliteConfig";

function QueryExecutor({ refreshTrigger, isDbInitialized }) {
  const [query, setQuery] = useState(
    "SELECT * FROM patients ORDER BY created_at DESC LIMIT 10"
  );
  const [results, setResults] = useState([]);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdateId, setLastUpdateId] = useState(0);
  const isFirstRender = useRef(true);

  const fetchPatients = useCallback(async () => {
    if (!isDbInitialized) return; // Prevent query execution if DB is not ready

    // Don't show loading indicator for quick refreshes
    const loadingTimer = setTimeout(() => {
      setIsLoading(true);
    }, 300);

    try {
      const result = await executeQuery(query, [], {
        skipQueue: true, // Read queries can skip the queue
        retries: 2, // Retry failed queries
      });

      if (Array.isArray(result.rows)) {
        console.log(`Fetched ${result.rows.length} patients`);
        setResults(result.rows);
      } else {
        console.warn("Query returned unexpected result format:", result);
        setResults([]);
      }
      setError(null);
    } catch (err) {
      console.error("Query execution error:", err);
      setError("Error executing query: " + err.message);
      setResults([]);
    } finally {
      clearTimeout(loadingTimer);
      setIsLoading(false);
    }
  }, [query, isDbInitialized]);

  // Set up database update listeners with cleanup
  useEffect(() => {
    if (!isDbInitialized) return;

    const unsubscribe = onDatabaseUpdate((event) => {
      if (event.type === "data_updated") {
        // Check if this update affects our table of interest
        const affectsPatients =
          !event.affectedTable ||
          event.affectedTable.toLowerCase() === "patients";

        if (affectsPatients) {
          console.log("Patients data changed, refreshing...");
          setLastUpdateId((prev) => prev + 1);
        }
      }
    });

    return () => {
      unsubscribe();
    };
  }, [isDbInitialized]);

  // Effect to handle data fetching with debounce
  useEffect(() => {
    if (!isDbInitialized) return;

    const fetchData = async () => {
      console.log("Fetching fresh patient data...");
      await fetchPatients();
    };

    // Immediate fetch on mount or when query changes
    if (isFirstRender.current) {
      isFirstRender.current = false;
      fetchData();
      return;
    }

    // Debounce rapid updates but respond quickly to changes
    const debounceTimer = setTimeout(fetchData, 100);

    return () => clearTimeout(debounceTimer);
  }, [fetchPatients, isDbInitialized, lastUpdateId, query]);

  const handleExecuteQuery = async () => {
    await fetchPatients();
  };

  return (
    <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
      <h2 className="text-2xl font-semibold text-gray-900 mb-6">
        Query Patient Records
      </h2>
      <div className="space-y-4">
        <div>
          <div className="flex justify-between mb-1">
            <label
              htmlFor="sql-query"
              className="block text-sm font-medium text-gray-700"
            >
              SQL Query
            </label>
          </div>
          <textarea
            id="sql-query"
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
            rows={4}
            placeholder="Enter your SQL query here..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={!isDbInitialized} // Disable input until DB is ready
          />
        </div>
        <div className="flex justify-between items-center">
          <button
            className={clsx(
              "px-4 py-2 text-white font-medium rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors",
              isDbInitialized
                ? "bg-blue-600 hover:bg-blue-700"
                : "bg-gray-400 cursor-not-allowed"
            )}
            onClick={handleExecuteQuery}
            disabled={!isDbInitialized || isLoading}
          >
            {isLoading ? "Executing..." : "Execute Query"}
          </button>

          {results.length > 0 && (
            <span className="text-sm text-gray-500">
              {results.length} record{results.length !== 1 ? "s" : ""} found
            </span>
          )}
        </div>
        {error && (
          <div className="text-red-500 text-sm mt-2" role="alert">
            {error}
          </div>
        )}
        <div className="mt-6">
          {!isDbInitialized ? (
            <div className="space-y-2">
              <div className="flex items-center justify-center py-8 text-gray-500">
                <svg
                  className="animate-spin h-5 w-5 mr-3 text-blue-500"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Initializing database...
              </div>
              <button
                onClick={() => window.location.reload()}
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                Still loading? Click here to reload
              </button>
            </div>
          ) : isLoading ? (
            <div className="flex items-center justify-center py-8 text-gray-500 bg-white rounded-lg border border-gray-200">
              <svg
                className="animate-spin h-5 w-5 mr-3 text-blue-500"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              Loading data...
            </div>
          ) : (
            <PatientTable data={results} />
          )}
        </div>
      </div>
    </div>
  );
}

export default QueryExecutor;
