/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";

interface PatientData {
  [key: string]: any;
}

interface PatientTableProps {
  data: PatientData[];
}

const PatientTable = ({ data }: PatientTableProps) => {
  const [localData, setLocalData] = useState<PatientData[]>(data || []);

  // Sync local data with props to prevent flash of empty state
  useEffect(() => {
    if (data && data.length > 0) {
      setLocalData(data);
    } else {
      // Add a small delay before showing empty state to allow for quick updates
      const timer = setTimeout(() => {
        setLocalData(data || []);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [data]);

  if (!localData || localData.length === 0) {
    return (
      <div
        className="flex items-center justify-center py-8 text-gray-500 bg-white rounded-lg border border-gray-200"
        aria-live="polite"
      >
        No patient records found.
      </div>
    );
  }

  // Get all unique keys from all rows to handle dynamic data
  const allKeys = Array.from(
    new Set(localData.flatMap((row) => Object.keys(row)))
  ).filter((key) => key !== "id"); // Exclude id from display if you prefer

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full bg-white border border-gray-200 rounded-lg">
        <thead>
          <tr className="bg-gray-50">
            {allKeys.map((key) => (
              <th
                key={key}
                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b border-gray-200"
              >
                {key.replace(/_/g, " ")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {localData.map((row, index) => (
            <tr key={index} className="hover:bg-gray-50">
              {allKeys.map((key) => (
                <td
                  key={`${index}-${key}`}
                  className="px-6 py-4 whitespace-nowrap text-sm text-gray-900"
                >
                  {row[key] !== null && row[key] !== undefined
                    ? row[key].toString()
                    : "-"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default PatientTable;
