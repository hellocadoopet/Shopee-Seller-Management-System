import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import "./index.css";
import Home from "./pages/Home";
import Login from "./pages/Login";
import Connect from "./pages/Connect";
import Pair from "./pages/Pair";
import DashboardLayout from "./pages/DashboardLayout";
import Overview from "./pages/Overview";
import Products from "./pages/Products";
import Orders from "./pages/Orders";
import Chat from "./pages/Chat";
import Vouchers from "./pages/Vouchers";
import Campaigns from "./pages/Campaigns";
import Ads from "./pages/Ads";
import Insights from "./pages/Insights";
import Settings from "./pages/Settings";
import RequireAuth from "./components/RequireAuth";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<RequireAuth />}>
          <Route path="/" element={<Home />} />
          <Route path="/connect" element={<Connect />} />
          <Route path="/connect/:platform" element={<Pair />} />
          <Route path="/dashboard" element={<DashboardLayout />}>
            <Route index element={<Overview />} />
            <Route path="products" element={<Products />} />
            <Route path="orders" element={<Orders />} />
            <Route path="chat" element={<Chat />} />
            <Route path="vouchers" element={<Vouchers />} />
            <Route path="campaigns" element={<Campaigns />} />
            <Route path="ads" element={<Ads />} />
            <Route path="insights" element={<Insights />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
