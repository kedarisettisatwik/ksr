import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  onSnapshot,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import toast, { Toaster } from "react-hot-toast";
import { app } from "./firebase";
import bannerVideo from "./assests/KSR_Banner_animation.mp4";
import bannerImage from "./assests/KSR_Banner.jpeg";
import logo from "./assests/KSR_logo.png";

const db = getFirestore(app);
const events = ["House warming", "Mature Function", "Death Tribute"];
const languages = ["English", "Telugu", "Tinglish"];
const userDoc = (phone) => doc(db, "db", phone);
const createOrderId = () => {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    return (char === 'x' ? random : (random & 0x3) | 0x8).toString(16);
  });
};
const formatPrice = (amount) =>
  `₹${Number(amount || 0)
    .toFixed(2)
    .replace(/\.00$/, "")}`;
const isQuantityProduct = (product) =>
  String(product.Type || "").toLowerCase() === "quantity";
const itemTotal = (item) =>
  (Number(item.price || 0) * Number(item.quantity || 0)) /
  (item.unit === "g" ? 1000 : 1);
const localDate = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};
const productName = (product, language) =>
  product[`Name_${language}`] ||
  product.Name_English ||
  product.name ||
  "Product";
const displayName = (category, language) =>
  category[`Name_${language}`] || category.Type || category.name || "Category";

function App() {
  const [phone, setPhone] = useState(
    () => localStorage.getItem("ksr_phone") || "",
  );
  const [language, setLanguage] = useState(
    () => localStorage.getItem("ksr_language") || "English",
  );
  const [phoneDraft, setPhoneDraft] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [videoDone, setVideoDone] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("featured");
  const [category, setCategory] = useState("");
  const [event, setEvent] = useState("");
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [cart, setCart] = useState([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [orders, setOrders] = useState([]);
  const [expandedOrder, setExpandedOrder] = useState(null);
  const [pickupName, setPickupName] = useState("");
  const [pickupTime, setPickupTime] = useState("");
  const [orderNotes, setOrderNotes] = useState("");
  const [quantityDrafts, setQuantityDrafts] = useState({});
  const [installPrompt, setInstallPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const total = cart.reduce((sum, item) => sum + itemTotal(item), 0);

  useEffect(() => {
    const stopCategories = onSnapshot(
      collection(db, "Categories"),
      (snapshot) => {
        setCategories(
          snapshot.docs
            .map((item) => ({ id: item.id, ...item.data() }))
            .filter((item) => item.Type),
        );
      },
      () => toast.error("Could not load categories."),
    );
    const stopProducts = onSnapshot(
      collection(db, "Products"),
      (snapshot) => {
        setProducts(
          snapshot.docs.map((item) => {
            const data = item.data();
            return { ...data, id: item.id, productID: data.productID || item.id };
          }),
        );
      },
      () => toast.error("Could not load products."),
    );
    return () => {
      stopCategories();
      stopProducts();
    };
  }, []);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true;
    setIsInstalled(standalone);
    const captureInstall = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    const installed = () => {
      setIsInstalled(true);
      setInstallPrompt(null);
      toast.success("KSR app installed");
    };
    window.addEventListener("beforeinstallprompt", captureInstall);
    window.addEventListener("appinstalled", installed);
    if ("serviceWorker" in navigator)
      navigator.serviceWorker
        .register(`${process.env.PUBLIC_URL}/service-worker.js`)
        .catch(() => {});
    return () => {
      window.removeEventListener("beforeinstallprompt", captureInstall);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);

  useEffect(() => {
    if (!phone) {
      setCart([]);
      setOrders([]);
      return undefined;
    }
    return onSnapshot(
      userDoc(phone),
      (snapshot) => {
        const data = snapshot.data() || {};
        setCart(
          Array.isArray(data.cart)
            ? data.cart.map((item) =>
                item.unit === "kg"
                  ? {
                      ...item,
                      unit: "g",
                      quantity: Math.round(Number(item.quantity || 0) * 1000),
                    }
                  : item,
              )
            : [],
        );
        setOrders(Array.isArray(data.orders) ? data.orders : []);
      },
      () => toast.error("Could not load your account."),
    );
  }, [phone]);

  const visibleProducts = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    const list = products.filter((item) => {
      const productCategories = Array.isArray(item.Category)
        ? item.Category
        : [];
      return (
        (!category || productCategories.includes(category)) &&
        (!term ||
          productName(item, language).toLocaleLowerCase().includes(term))
      );
    });
    if (sort === "low")
      list.sort((a, b) => Number(a.Price || 0) - Number(b.Price || 0));
    if (sort === "high")
      list.sort((a, b) => Number(b.Price || 0) - Number(a.Price || 0));
    return list;
  }, [category, language, products, query, sort]);

  const savePhone = async (e) => {
    e.preventDefault();
    const digits = phoneDraft.replace(/\D/g, "");
    if (!/^\d{10}$/.test(digits)) {
      setPhoneError("Enter a 10-digit phone number.");
      return;
    }
    try {
      const usersRef = doc(db, "Users", digits);
      const [existing, userRecord] = await Promise.all([
        getDoc(userDoc(digits)),
        getDoc(usersRef),
      ]);
      const previous = existing.data() || {};
      const dateCreated = previous.date_created || userRecord.data()?.date_created || localDate();

      if (!userRecord.exists()) {
        await setDoc(usersRef, {
          phone_number: digits,
          preferred_language: language,
          date_created: dateCreated,
        });
      }

      await setDoc(
        userDoc(digits),
        {
          phone_number: digits,
          preferred_language: language,
          date_created: dateCreated,
          cart: previous.cart || [],
          orders: previous.orders || [],
        },
        { merge: true },
      );
      localStorage.setItem("ksr_phone", digits);
      localStorage.setItem("ksr_language", language);
      setPhone(digits);
      setPhoneError("");
      toast.success(language === "Telugu" ? "స్వాగతం!" : "You’re signed in!");
    } catch{
      setPhoneError("Unable to save your number. Please try again.");
      toast.error("Could not sign you in.");
    }
  };

  const changeCart = async (product, amount) => {
    if (!phone) {
      toast.error("Enter your phone number to add items.");
      document
        .getElementById("phone-entry")
        ?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    const countable = !isQuantityProduct(product);
    const itemName = productName(product, language);
    const next = [...cart];
    const index = next.findIndex((item) => item.id === product.id);
    if (index >= 0) {
      const quantity = Number(next[index].quantity) + amount;
      if (quantity <= 0) next.splice(index, 1);
      else
        next[index] = {
          ...next[index],
          name: itemName,
          productID: product.productID || product.id,
          price: Number(product.Price || 0),
          quantity,
        };
    } else if (amount > 0)
      next.push({
        id: product.id,
        productID: product.productID || product.id,
        name: itemName,
        price: Number(product.Price || 0),
        unit: countable ? "unit" : "g",
        min: Number(product.Min || 0),
        quantity: countable ? amount : Number(product.Min || 0),
      });
    setCart(next);
    try {
      await setDoc(userDoc(phone), { cart: next }, { merge: true });
      if (amount > 0 && index < 0) toast.success(`${itemName} added to cart`);
    } catch {
      toast.error("Cart could not sync. Please try again.");
    }
  };

  const addQuantityProduct = async (product, grams) => {
    if (!phone) {
      toast.error("Enter your phone number to add items.");
      document
        .getElementById("phone-entry")
        ?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    const quantity = Number(grams);
    const minimum = Number(product.Min || 0);
    if (!Number.isInteger(quantity) || quantity < minimum) {
      toast.error(`Enter at least ${minimum} grams.`);
      return;
    }
    const name = productName(product, language);
    const next = [...cart];
    const index = next.findIndex((item) => item.id === product.id);
    const row = {
      id: product.id,
      productID: product.productID || product.id,
      name,
      price: Number(product.Price || 0),
      unit: "g",
      min: minimum,
      quantity,
    };
    if (index >= 0) next[index] = row;
    else next.push(row);
    setCart(next);
    try {
      await setDoc(userDoc(phone), { cart: next }, { merge: true });
      toast.success(`${name} added to cart`);
    } catch {
      toast.error("Cart could not sync. Please try again.");
    }
  };

  const setCartGrams = async (item, grams) => {
    if (grams === "" || !Number.isInteger(Number(grams))) return;
    const quantity = Number(grams);
    if (quantity < Number(item.min || 0)) {
      toast.error(`Enter at least ${item.min} grams.`);
      return;
    }
    const next = cart.map((row) =>
      row.id === item.id ? { ...row, quantity } : row,
    );
    setCart(next);
    try {
      await setDoc(userDoc(phone), { cart: next }, { merge: true });
    } catch {
      toast.error("Cart could not sync. Please try again.");
    }
  };

  const removeCartItem = async (id) => {
    const next = cart.filter((item) => item.id !== id);
    setCart(next);
    try {
      await setDoc(userDoc(phone), { cart: next }, { merge: true });
      toast.success("Item removed from cart");
    } catch {
      toast.error("Cart could not sync. Please try again.");
    }
  };

  const changeLanguage = async (value) => {
    setLanguage(value);
    localStorage.setItem("ksr_language", value);
    if (phone) {
      try {
        await setDoc(
          userDoc(phone),
          { preferred_language: value },
          { merge: true },
        );
        toast.success("Language updated");
      } catch {
        toast.error("Could not save language.");
      }
    }
  };

  const loadOrders = async () => {
    if (!phone) return;
    try {
      const snapshot = await getDocs(collection(db, "db", phone, "orders"));
      const loaded = snapshot.docs
        .map((order) => ({ id: order.id, ...order.data() }))
        .sort((a, b) =>
          String(b.date || "").localeCompare(String(a.date || "")),
        );
      setOrders(loaded.length ? loaded : orders);
    } catch {
      /* Embedded order history remains available. */
    }
  };

  const placeOrder = async () => {
    if (!phone) {
      toast.error("Enter your phone number before ordering.");
      return;
    }
    if (!cart.length) return;
    if (!pickupName.trim() || !pickupTime) {
      toast.error("Add the pickup person’s name and pickup time.");
      return;
    }
    try {
      const orderId = createOrderId();
      const order = {
        order_id: orderId,
        phone_number: phone,
        date: localDate(),
        items: cart.map((item) => ({ ...item, productID: item.productID || item.id })),
        total,
        language,
        pickup_name: pickupName.trim(),
        pickup_time: pickupTime,
        notes: orderNotes.trim(),
        status: "order still in review",
      };
      const batch = writeBatch(db);
      batch.set(doc(db, "Orders", orderId), order);
      batch.set(doc(db, "db", phone, "orders", orderId), order);
      batch.set(userDoc(phone), { cart: [] }, { merge: true });
      await batch.commit();
      setCart([]);
      setOrderNotes("");
      setCartOpen(false);
      const message = [
        "Hi,",
        "I placed order, review.",
        "",
        `Order ID : ${order.order_id}`,
        `pickup name : ${order.pickup_name}`,
        `pickup time : ${new Date(order.pickup_time).toLocaleString("en-IN")}`,
        "",
        "Thanks,",
      ].join("\n");
      window.location.href = `https://wa.me/919290864905?text=${encodeURIComponent(message)}`;
    } catch {
      toast.error("Could not submit your order. Please try again.");
    }
  };

  const logout = () => {
    localStorage.removeItem("ksr_phone");
    setPhone("");
    setCart([]);
    setOrders([]);
    setProfileOpen(false);
    toast.success("You’re signed out");
  };

  const installApp = async () => {
    if (isInstalled) {
      toast.success("KSR is already installed");
      return;
    }
    if (!installPrompt) {
      toast(
        "To install, use your browser menu and choose “Install app” or “Add to Home Screen”.",
        { duration: 5000, icon: "📲" },
      );
      return;
    }
    installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice?.outcome === "accepted") toast.success("Installing KSR…");
    setInstallPrompt(null);
  };

  const activeOrders = orders.filter((order) => order.status !== "Done");
  const pastOrders = orders.filter((order) => order.status === "Done");
  const renderOrderCard = (order, index) => {
    const orderKey = order.id || index;
    return (
      <div className="order-card" key={orderKey}>
        <button
          className="order-summary"
          onClick={() => setExpandedOrder(expandedOrder === orderKey ? null : orderKey)}
        >
          <span>
            <strong>Order #{order.order_number || order.id || index + 1}</strong>
            <small>{order.date || "Date unavailable"} · {order.status || "status unavailable"} · {order.items?.length || 0} items</small>
          </span>
          <span className="order-value">
            {formatPrice(order.total || order.amount || 0)} <b>{expandedOrder === orderKey ? "−" : "+"}</b>
          </span>
        </button>
        {expandedOrder === orderKey && (
          <div className="order-details">
            {(order.items || []).map((item, itemIndex) => (
              <div key={item.productID || item.id || itemIndex}>
                <span>{item.name} × {item.quantity}{item.unit === "g" ? " g" : ""}</span>
                <strong>{formatPrice(itemTotal(item))}</strong>
              </div>
            ))}
            {!order.items?.length && <p>Order item details are not available.</p>}
          </div>
        )}
      </div>
    );
  };

  return (
    <main className="app-shell">
      <Toaster
        position="top-center"
        toastOptions={{
          duration: 2600,
          style: { fontSize: "13px", borderRadius: "12px", maxWidth: "360px" },
        }}
      />
      <div id="top" className="hero" aria-label="KSR store banner">
        <header className="topbar">
          <div className="header-spacer" />
          <div className="header-actions">
            <button
              className="icon-button"
              aria-label={`Cart, ${cart.length} products`}
              onClick={() => {
                setCartOpen(true);
                setPickupTime((current) => {
                  const time = current.split("T")[1] || "10:00";
                  return `${localDate()}T${time}`;
                });
              }}
            >
              <span className="icon">🛒</span>
              {cart.length > 0 && <i>{cart.length}</i>}
            </button>
            <button
              className="icon-button"
              aria-label="Your account"
              onClick={() => {
                setProfileOpen(true);
                loadOrders();
              }}
            >
              <span className="icon">♙</span>
            </button>
          </div>
        </header>
        {!videoDone ? (
          <video
            autoPlay
            muted
            playsInline
            onEnded={() => setVideoDone(true)}
            onError={() => setVideoDone(true)}
          >
            <source src={bannerVideo} type="video/mp4" />
          </video>
        ) : (
          <img src={bannerImage} alt="Welcome to KSR" />
        )}
      </div>

      <section
        id="phone-entry"
        className={`phone-card ${phone ? "phone-card-saved" : ""}`}
      >
        {phone ? (
          <>
            <span className="status-dot" />
            <div>
              <strong>Welcome to KSR</strong>
              <p>Shopping as +91 {phone}</p>
            </div>
          </>
        ) : (
          <>
            <div className="phone-copy">
              <span className="phone-emoji">📱</span>
              <div>
                <strong>Stay connected</strong>
                <p>Enter your phone number to shop</p>
              </div>
            </div>
            <form className="phone-form" onSubmit={savePhone}>
              <div className="phone-input">
                <span>+91</span>
                <input
                  aria-label="10-digit phone number"
                  inputMode="numeric"
                  maxLength="10"
                  value={phoneDraft}
                  onChange={(e) =>
                    setPhoneDraft(e.target.value.replace(/\D/g, ""))
                  }
                  placeholder="10-digit phone number"
                />
              </div>
              <button className="primary-button" type="submit">
                Continue
              </button>
            </form>
            {phoneError && <p className="form-error">{phoneError}</p>}
          </>
        )}
      </section>

      <section className="discovery">
        <div className="search-row">
          <label className="search-box">
            <span>⌕</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search products..."
              aria-label="Search products by name"
            />
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery("")}
            >
              ×
            </button>
          </label>
          <select
            aria-label="Sort products by price"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="featured">Sort</option>
            <option value="low">Price: Low to high</option>
            <option value="high">Price: High to low</option>
          </select>
        </div>
        <div className="section-heading">
          <div>
            <span className="eyebrow">FIND YOUR FAVOURITES</span>
            <h2>Filter by categories</h2>
          </div>
          <button className="reset-filter" onClick={() => setCategory("")}>
            View all
          </button>
        </div>
        <div className="horizontal-scroll categories">
          {categories.map((item) => (
            <button
              key={item.id}
              onClick={() =>
                setCategory(category === item.Type ? "" : item.Type)
              }
              className={`category-chip ${category === item.Type ? "selected" : ""}`}
            >
              <span className="category-icon">{item.Icon || "◉"}</span>
              {displayName(item, language)}
            </button>
          ))}
        </div>
        <div className="section-heading event-heading">
          <div>
            <span className="eyebrow">CELEBRATE EVERY MOMENT</span>
            <h2>Shop by Festival / Events</h2>
          </div>
        </div>
        <div className="horizontal-scroll events">
          {events.map((item, index) => (
            <button
              key={item}
              onClick={() => setEvent(event === item ? "" : item)}
              className={`event-card event-${index} ${event === item ? "selected" : ""}`}
            >
              <span>{["🏡", "🎉", "🕊️"][index]}</span>
              <strong>{item}</strong>
              <small>Shop essentials →</small>
            </button>
          ))}
        </div>
      </section>

      <section className="products-section">
        <div className="products-title">
          <div>
            <span className="eyebrow">HANDPICKED FOR YOU</span>
            <h2>{category || "Shop products"}</h2>
          </div>
          <span className="product-count">{visibleProducts.length} items</span>
        </div>
        {visibleProducts.length ? (
          <div className="product-grid">
            {visibleProducts.map((product) => {
              const inCart = cart.find((item) => item.id === product.id);
              const quantityProduct = isQuantityProduct(product);
              const step = 1;
              const name = productName(product, language);
              return (
                <article className="product-card" key={product.id}>
                  <div className="product-image">
                    <img
                      src={product.Image || product.Image_URL || logo}
                      alt={name}
                    />
                  </div>
                  <div className="product-info">
                    <h3>{name}</h3>
                    <div className="product-bottom">
                      <strong>
                        {formatPrice(product.Price)}
                        <small> / {quantityProduct ? "kg" : "unit"}</small>
                      </strong>
                      {quantityProduct ? (
                        <div className="quantity-control">
                          <input
                            aria-label={`${name} quantity in grams`}
                            type="number"
                            min={product.Min || 1}
                            step="1"
                            value={
                              quantityDrafts[product.id] ??
                              inCart?.quantity ??
                              product.Min ??
                              1
                            }
                            onChange={(e) =>
                              setQuantityDrafts({
                                ...quantityDrafts,
                                [product.id]: e.target.value,
                              })
                            }
                            onBlur={() => {
                              if (inCart)
                                setCartGrams(
                                  inCart,
                                  quantityDrafts[product.id] ?? inCart.quantity,
                                );
                            }}
                          />
                          <span>g</span>
                          <button
                            className="add-button"
                            style={{
                              position: "absolute",
                              bottom: "0px",
                              transform: "translate(10px,-55px)",
                            }}
                            onClick={() =>
                              addQuantityProduct(
                                product,
                                quantityDrafts[product.id] ?? product.Min ?? 1,
                              )
                            }
                          >
                            {inCart ? "UPDATE" : "ADD"} <span>＋</span>
                          </button>
                        </div>
                      ) : inCart ? (
                        <div className="quantity-stepper">
                          <button
                            aria-label="Remove one"
                            onClick={() => changeCart(product, -step)}
                          >
                            −
                          </button>
                          <span>{inCart.quantity}</span>
                          <button
                            aria-label="Add one"
                            onClick={() => changeCart(product, step)}
                          >
                            +
                          </button>
                        </div>
                      ) : (
                        <button
                          className="add-button"
                          onClick={() => changeCart(product, step)}
                        >
                          ADD <span>＋</span>
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="empty-state">
            <span>🔎</span>
            <strong>
              {products.length ? "No products found" : "Loading products…"}
            </strong>
            <p>
              {products.length
                ? "Try another search or category."
                : "Please check back in a moment."}
            </p>
          </div>
        )}
      </section>
      <footer className="site-footer">
        <h2>Thank you for shopping with us</h2>
        <div className="contact-details">
          <h3>Contact details</h3>
          <p>
            <strong>Shop name</strong>
            <span>kedarisetti Subarao &amp; C.0</span>
          </p>
          <p>
            <strong>Phone number</strong>
            <a href="tel:9290864905">9290864905</a>
          </p>
          <p>
            <strong>Address</strong>
            <span>33-2-2, Main market, near glass house, sai baba temple</span>
          </p>
          <a
            className="map-link"
            href="https://maps.app.goo.gl/TSJ4AgxuxMzR8ffZ6"
            target="_blank"
            rel="noreferrer"
          >
            Open location in Maps ↗
          </a>
        </div>
      </footer>
      <button
        className="install-app-button"
        onClick={installApp}
        disabled={isInstalled}
      >
        {isInstalled ? "App installed ✓" : "Install as APP"}
        <span aria-hidden="true">⇩</span>
      </button>

      {cartOpen && (
        <div
          className="overlay"
          onMouseDown={(e) =>
            e.target === e.currentTarget && setCartOpen(false)
          }
        >
          <section
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Your cart"
          >
            <div className="sheet-header">
              <div>
                <span className="eyebrow">YOUR SELECTION</span>
                <h2>Your cart</h2>
              </div>
              <button
                className="close-button"
                onClick={() => setCartOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            {cart.length ? (
              <>
                <div className="cart-items">
                  {cart.map((item) => (
                    <div className="cart-line" key={item.id}>
                      <div>
                        <strong>{item.name}</strong>
                        {item.unit === "g" ? (
                          <>
                            <small>
                              {item.quantity} g · {formatPrice(item.price)} per
                              kg
                            </small>
                            <label className="cart-grams">
                              Quantity in grams
                              <input
                                type="number"
                                min={item.min || 1}
                                step="1"
                                value={quantityDrafts[item.id] ?? item.quantity}
                                onChange={(e) =>
                                  setQuantityDrafts({
                                    ...quantityDrafts,
                                    [item.id]: e.target.value,
                                  })
                                }
                                onBlur={(e) => {
                                  const value = Number(e.target.value);
                                  if (
                                    Number.isInteger(value) &&
                                    value >= Number(item.min || 0)
                                  )
                                    setCartGrams(item, value);
                                  else {
                                    toast.error(
                                      `Enter at least ${item.min} grams.`,
                                    );
                                    setQuantityDrafts({
                                      ...quantityDrafts,
                                      [item.id]: item.quantity,
                                    });
                                  }
                                }}
                              />
                            </label>
                          </>
                        ) : (
                          <small>
                            {item.quantity} unit × {formatPrice(item.price)}
                          </small>
                        )}
                      </div>
                      <div className="cart-line-total">
                        <b>{formatPrice(itemTotal(item))}</b>
                        <button onClick={() => removeCartItem(item.id)}>
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="cart-total">
                  <span>Total</span>
                  <strong>{formatPrice(total)}</strong>
                </div>
                <div className="pickup-fields">
                  <label>
                    Name of person picking up
                    <input
                      value={pickupName}
                      onChange={(e) => setPickupName(e.target.value)}
                      placeholder="Enter pickup person's name"
                    />
                  </label>
                  <label>
                    When will you come?
                    <input
                      type="datetime-local"
                      value={pickupTime}
                      onChange={(e) => setPickupTime(e.target.value)}
                    />
                  </label>
                  <label className="order-notes-field">
                    Notes (optional)
                    <textarea
                      value={orderNotes}
                      onChange={(e) => setOrderNotes(e.target.value)}
                      placeholder="Add any notes for your order"
                      rows={3}
                    />
                  </label>
                </div>
                <button
                  className="primary-button full-button"
                  onClick={placeOrder}
                >
                  Buy now · {formatPrice(total)}
                </button>
              </>
            ) : (
              <div className="empty-state">
                <span>🛍️</span>
                <strong>Your cart is waiting</strong>
                <p>Add a few favourites to get started.</p>
                <button
                  className="primary-button"
                  onClick={() => setCartOpen(false)}
                >
                  Explore products
                </button>
              </div>
            )}
          </section>
        </div>
      )}
      {profileOpen && (
        <div
          className="overlay"
          onMouseDown={(e) =>
            e.target === e.currentTarget && setProfileOpen(false)
          }
        >
          <section
            className="sheet profile-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Your profile"
          >
            <div className="sheet-header">
              <div>
                <span className="eyebrow">YOUR KSR ACCOUNT</span>
                <h2>Your profile</h2>
              </div>
              <button
                className="close-button"
                onClick={() => setProfileOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="profile-phone">
              <span>♙</span>
              <div>
                <small>PHONE NUMBER</small>
                <strong>{phone ? `+91 ${phone}` : "Not added yet"}</strong>
              </div>
            </div>
            <label className="language-row">
              <span>Preferred language</span>
              <select
                aria-label="Change preferred language"
                value={language}
                onChange={(e) => changeLanguage(e.target.value)}
              >
                {languages.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <div className="order-heading">
              <h3>In progress orders</h3>
              <span>{activeOrders.length} orders</span>
            </div>
            {activeOrders.length ? (
              <div className="orders-list">{activeOrders.map(renderOrderCard)}</div>
            ) : (
              <div className="empty-state compact"><span>📦</span><strong>No active orders</strong><p>Orders that are not done will appear here.</p></div>
            )}
            <div className="order-heading past-orders-heading">
              <h3>Past orders</h3>
              <span>{pastOrders.length} orders</span>
            </div>
            {pastOrders.length ? (
              <div className="orders-list">{pastOrders.map(renderOrderCard)}</div>
            ) : (
              <div className="empty-state compact"><span>🧾</span><strong>No past orders yet</strong><p>Completed orders will appear here.</p></div>
            )}
            <button className="logout-button" onClick={logout}>
              Log out
            </button>
          </section>
        </div>
      )}
    </main>
  );
}

export default App;
