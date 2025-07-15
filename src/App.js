import React, { useState } from "react";
import Schedule from "./components/Schedule";
import StudentForm from "./components/StudentForm";

const App = () => {
  const [view, setView] = useState("schedule");

  return (
    <div>
      <button
        onClick={() => setView(view === "schedule" ? "students" : "schedule")}
      >
        {view === "schedule" ? "Schüler verwalten" : "Trainingsplan anzeigen"}
      </button>
      {view === "schedule" ? <Schedule /> : <StudentForm />}
    </div>
  );
};

export default App;
