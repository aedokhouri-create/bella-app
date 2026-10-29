import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import Entrada from "./Entrada.jsx";
import "./styles.css";

// Qualquer resposta dizendo que a sessão acabou leva de volta à tela de entrada.
const fetchOriginal = window.fetch.bind(window);
window.fetch = async (...args) => {
  const res = await fetchOriginal(...args);
  if (res.status === 401 && res.headers.get("X-Bella-Login") === "necessario") {
    window.dispatchEvent(new Event("bella:login-necessario"));
  }
  return res;
};

function Portao() {
  const [estado, setEstado] = useState("carregando");

  useEffect(() => {
    fetchOriginal("/api/auth/status")
      .then((r) => r.json())
      .then((d) => setEstado(d.logado ? "dentro" : "fora"))
      // Sem rede: abre o app mesmo assim (as tarefas guardadas offline continuam
      // visíveis); se a sessão tiver acabado, a primeira chamada à API avisa.
      .catch(() => setEstado("dentro"));
    const sair = () => setEstado("fora");
    window.addEventListener("bella:login-necessario", sair);
    return () => window.removeEventListener("bella:login-necessario", sair);
  }, []);

  if (estado === "carregando") return null;
  if (estado === "fora") {
    return (
      <div className="tela-entrada">
        <Entrada aoEntrar={() => setEstado("dentro")} />
      </div>
    );
  }
  return <App />;
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Portao />
  </React.StrictMode>
);
