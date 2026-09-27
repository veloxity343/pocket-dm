import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AppProvider } from "./context/app";
import { DiceProvider } from "./context/dice";
import { DialogProvider, DrawerProvider, ToastProvider } from "./context/ui";
import "./styles/app.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <DialogProvider>
          <DrawerProvider>
            <AppProvider>
              <DiceProvider>
                <App />
              </DiceProvider>
            </AppProvider>
          </DrawerProvider>
        </DialogProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
