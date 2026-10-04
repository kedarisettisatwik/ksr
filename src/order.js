import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { doc, getDoc, getFirestore } from "firebase/firestore";
import { app } from "./firebase";
import bannerImage from "./assests/KSR_Banner.jpeg";
import "./order.css";

const db = getFirestore(app);
const currency = (value) =>
  `₹${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const itemTotal = (item) =>
  (Number(item.price || 0) * Number(item.quantity || 0)) /
  (item.unit === "g" ? 1000 : 1);

export default function Order() {
  const { orderID } = useParams();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    getDoc(doc(db, "Orders", orderID))
      .then((snapshot) => {
        if (!active) return;
        if (!snapshot.exists()) {
          setError("We could not find this order.");
          setOrder(null);
          return;
        }
        setOrder({ id: snapshot.id, ...snapshot.data() });
      })
      .catch(() => {
        if (active) setError("Could not load order details. Please try again later.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [orderID]);

  const total = order
    ? Number(
        order.total ??
          order.amount ??
          (order.items || []).reduce((sum, item) => sum + itemTotal(item), 0),
      )
    : 0;

  return (
    <main className="order-page">
      <img className="order-banner" src={bannerImage} alt="KSR store" />
      <section className="order-content">
        <span className="order-eyebrow">KEDARISETTI SUBARAO &amp; CO.</span>
        <h1>Order details</h1>
        <p className="order-reference">Order ID: {orderID}</p>

        {loading ? (
          <p className="order-message">Loading order…</p>
        ) : error ? (
          <p className="order-message order-error">{error}</p>
        ) : (
          <>
            <div className="order-info-grid">
              <div><span>Pickup person</span><strong>{order.pickup_name || "Not provided"}</strong></div>
              <div><span>Pickup time</span><strong>{order.pickup_time || "Not provided"}</strong></div>
              <div><span>Phone number</span><strong>{order.phone_number || "Not provided"}</strong></div>
              <div><span>Order status</span><strong className="order-status">{order.status || "order still in review"}</strong></div>
            </div>
            <div className="order-notes">
              <span>Notes</span>
              <p>{order.notes || order.note || "No notes"}</p>
              {order.admin_notes?.length > 0 && (
                <ul className="order-admin-notes">
                  {order.admin_notes.map((note, index) => (
                    <li key={`${note.created_at || "note"}-${index}`}>
                      {note.text || note}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <section className="order-items-section">
              <h2>Items</h2>
              {(order.items || []).length ? (
                <div className="order-items-list">
                  {order.items.map((item, index) => (
                    <article className="order-line-item" key={item.productID || item.id || index}>
                      <div>
                        <strong>{item.name || item.Name_English || "Product"}</strong>
                        <span>
                          {item.quantity}{item.unit === "g" ? " g" : " unit"} × {currency(item.price)}{item.unit === "g" ? " / kg" : ""}
                        </span>
                      </div>
                      <strong>{currency(itemTotal(item))}</strong>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="order-message">No items found in this order.</p>
              )}
              <div className="order-total"><span>Total</span><strong>{currency(total)}</strong></div>
            </section>
          </>
        )}

        <footer className="order-footer">
          <p>Thank you for shopping with us</p>
          <Link to="/">Continue shopping</Link>
        </footer>
      </section>
    </main>
  );
}
