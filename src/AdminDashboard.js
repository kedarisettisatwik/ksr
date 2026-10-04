import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addDoc,
  arrayUnion,
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  runTransaction,
  writeBatch,
} from "firebase/firestore";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { Link } from "react-router-dom";
import toast, { Toaster } from "react-hot-toast";
import { app } from "./firebase";
import logo from "./assests/KSR_logo.png";
import "./AdminDashboard.css";

const db = getFirestore(app);
const auth = getAuth(app);
const STATUSES = [
  "order still in review",
  "In Review",
  "order in progress",
  "Ready",
  "Done",
];
const STATUS_LABELS = {
  "order still in review": "Pending",
  "In Review": "In Review",
  "order in progress": "In progress",
  Ready: "Ready",
  Done: "Done",
};
const currency = (value) =>
  `₹${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const lineTotal = (item) =>
  (Number(item.price || 0) * Number(item.quantity || 0)) /
  (item.unit === "g" ? 1000 : 1);
const orderTotal = (order) =>
  Number(
    order.total ??
      order.amount ??
      (order.items || []).reduce((sum, item) => sum + lineTotal(item), 0),
  );
const orderDate = (order) =>
  String(order.date || order.created_at || "").slice(0, 10);
const pickupTimestamp = (order) => {
  if (!order.pickup_time) return Number.POSITIVE_INFINITY;
  const timestamp = new Date(order.pickup_time).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY;
};
const productTitle = (product) =>
  product.Name_English ||
  product.Name_Telugu ||
  product.Name_Tinglish ||
  product.name ||
  "Product";
const PRODUCT_CSV_HEADERS = [
  "productID",
  "Name_English",
  "Name_Tinglish",
  "Name_Telugu",
  "price",
  "stock",
  "costingPrice",
  "Quantity (1) / Countable (0)",
  "Min",
  "Image_URL",
  "category",
];
const csvCell = (value) => {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted && char === '"' && text[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
};
const orderProfit = (order, costs) =>
  (order.items || []).reduce((sum, item) => {
    const productId = String(item.productID || item.id || "");
    const cost = costs.get(productId);
    if (cost == null) return sum;
    const multiplier =
      item.unit === "g"
        ? Number(item.quantity || 0) / 1000
        : Number(item.quantity || 0);
    return sum + (Number(item.price || 0) - cost) * multiplier;
  }, 0);
const orderCost = (order, costs) =>
  (order.items || []).reduce((sum, item) => {
    const productID = String(item.productID || item.id || "");
    const cost = costs.get(productID);
    if (cost == null) return sum;
    const multiplier =
      item.unit === "g"
        ? Number(item.quantity || 0) / 1000
        : Number(item.quantity || 0);
    return sum + cost * multiplier;
  }, 0);
const localDateKey = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const numberOrZero = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

function AdminDashboard() {
  const csvUploadRef = useRef(null);
  const [authReady, setAuthReady] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState("");
  const [activeTab, setActiveTab] = useState("dashboard");
  const [usersCount, setUsersCount] = useState(0);
  const [orders, setOrders] = useState([]);
  const [adminProducts, setAdminProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [productNameFilter, setProductNameFilter] = useState("");
  const [productCategoryFilter, setProductCategoryFilter] = useState("all");
  const [stockBelowFilter, setStockBelowFilter] = useState("");
  const [productTypeFilter, setProductTypeFilter] = useState("all");
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [categoryType, setCategoryType] = useState("");
  const [categoryIcon, setCategoryIcon] = useState("");
  const [categoryError, setCategoryError] = useState("");
  const [savingCategory, setSavingCategory] = useState(false);
  const [showProductForm, setShowProductForm] = useState(false);
  const [savingProduct, setSavingProduct] = useState(false);
  const [productError, setProductError] = useState("");
  const [editingProductId, setEditingProductId] = useState("");
  const [productForm, setProductForm] = useState({
    Name_English: "",
    Name_Telugu: "",
    Name_Tinglish: "",
    Image_URL: "",
    Price: "",
    costingPrice: "",
    stock: "",
    Type: "Countable",
    Min: "",
  });
  const [productCategories, setProductCategories] = useState([]);
  const [profitValue, setProfitValue] = useState(0);
  const [dailyProfits, setDailyProfits] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [orderSearchFilter, setOrderSearchFilter] = useState("");
  const [profitFromDate, setProfitFromDate] = useState("");
  const [profitToDate, setProfitToDate] = useState("");
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [savingStatus, setSavingStatus] = useState(false);
  const [adminNoteDraft, setAdminNoteDraft] = useState("");
  const [savingAdminNote, setSavingAdminNote] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [
        usersSnapshot,
        ordersSnapshot,
        categoriesSnapshot,
        productsSnapshot,
        legacyProductsSnapshot,
        profitSnapshot,
        dailyProfitSnapshot,
      ] = await Promise.all([
        getDocs(collection(db, "Users")),
        getDocs(collection(db, "Orders")),
        getDocs(collection(db, "Categories")),
        getDocs(collection(db, "productsAdmin")),
        getDocs(collection(db, "ProductsAdmin")),
        getDoc(doc(db, "Profit", "NetGain")),
        getDocs(collection(db, "Profit")),
      ]);
      setUsersCount(usersSnapshot.size);
      setCategories(
        categoriesSnapshot.docs
          .map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }))
          .sort((a, b) =>
            String(a.Type || "").localeCompare(String(b.Type || "")),
          ),
      );
      const productMap = new Map();
      [...legacyProductsSnapshot.docs, ...productsSnapshot.docs].forEach(
        (snapshot) => {
          const data = snapshot.data();
          const product = {
            ...data,
            id: snapshot.id,
            productID: String(data.productID || snapshot.id),
            ref: snapshot.ref,
          };
          productMap.set(product.productID, product);
        },
      );
      setAdminProducts(
        [...productMap.values()].sort((a, b) =>
          productTitle(a).localeCompare(productTitle(b)),
        ),
      );
      const netProfit = profitSnapshot.data() || {};
      setProfitValue(numberOrZero(netProfit.gain ?? netProfit.value));
      setDailyProfits(
        Object.fromEntries(
          dailyProfitSnapshot.docs
            .filter((snapshot) => snapshot.id !== "NetGain")
            .map((snapshot) => [snapshot.id, snapshot.data()]),
        ),
      );
      const loadedOrders = ordersSnapshot.docs
        .map((snapshot) => {
          const data = snapshot.data();
          return {
            ...data,
            id: snapshot.id,
            phone: data.phone_number || "",
            ref: snapshot.ref,
          };
        })
        .sort((a, b) => pickupTimestamp(a) - pickupTimestamp(b));
      setOrders(loadedOrders);
      setSelectedOrder((current) =>
        current
          ? loadedOrders.find((order) => order.id === current.id) || null
          : null,
      );
    } catch (error) {
      setLoadError(
        "Could not load dashboard data. Check Firestore permissions for Users and order records.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(
    () =>
      onAuthStateChanged(auth, (user) => {
        setCurrentUser(user);
        setAuthReady(true);
      }),
    [],
  );

  useEffect(() => {
    if (currentUser) loadData();
    else {
      setOrders([]);
      setAdminProducts([]);
      setProfitValue(0);
      setUsersCount(0);
      setCategories([]);
      setSelectedOrder(null);
      setLoading(false);
    }
  }, [currentUser, loadData]);

  const handleSignIn = async (event) => {
    event.preventDefault();
    setSigningIn(true);
    setSignInError("");
    try {
      await signInWithEmailAndPassword(auth, username.trim(), password);
      setPassword("");
      toast.success("Signed in to admin dashboard");
    } catch {
      setSignInError("Sign-in failed. Check your username and password.");
    } finally {
      setSigningIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setActiveTab("dashboard");
      toast.success("You are signed out");
    } catch {
      toast.error("Could not sign out. Try again.");
    }
  };

  const createCategory = async (event) => {
    event.preventDefault();
    const type = categoryType.trim();
    const icon = categoryIcon.trim();
    if (!type || !icon) {
      setCategoryError("Enter both a category type and icon.");
      return;
    }
    if (
      categories.some(
        (item) => String(item.Type || "").toLowerCase() === type.toLowerCase(),
      )
    ) {
      setCategoryError("A category with this type already exists.");
      return;
    }
    setSavingCategory(true);
    setCategoryError("");
    try {
      const ref = await addDoc(collection(db, "Categories"), {
        Type: type,
        Icon: icon,
      });
      setCategories((current) =>
        [...current, { id: ref.id, Type: type, Icon: icon }].sort((a, b) =>
          a.Type.localeCompare(b.Type),
        ),
      );
      setCategoryType("");
      setCategoryIcon("");
      setShowCategoryForm(false);
      toast.success("Category added");
    } catch {
      setCategoryError(
        "Could not save this category. Check Firestore permissions and try again.",
      );
    } finally {
      setSavingCategory(false);
    }
  };

  const createProduct = async (event) => {
    event.preventDefault();
    const price = Number(productForm.Price);
    const costingPrice = Number(productForm.costingPrice);
    const stock = Number(productForm.stock);
    const minimum =
      productForm.Type === "Quantity" ? Number(productForm.Min || 0) : null;
    if (
      !productForm.Name_English.trim() ||
      !Number.isFinite(price) ||
      price < 0 ||
      !Number.isFinite(costingPrice) ||
      costingPrice < 0 ||
      !Number.isInteger(stock) ||
      stock < 0 ||
      productCategories.length === 0
    ) {
      setProductError(
        "Enter an English name, valid prices and stock, and select at least one category.",
      );
      return;
    }
    if (
      productForm.Type === "Quantity" &&
      (!Number.isInteger(minimum) || minimum <= 0)
    ) {
      setProductError("Enter a minimum quantity in whole grams.");
      return;
    }
    setSavingProduct(true);
    setProductError("");
    try {
      const isEdit = Boolean(editingProductId);
      const productID = editingProductId || doc(collection(db, "Products")).id;
      const sharedData = {
        productID,
        Name_English: productForm.Name_English.trim(),
        Name_Telugu: productForm.Name_Telugu.trim(),
        Name_Tinglish: productForm.Name_Tinglish.trim(),
        Image_URL: productForm.Image_URL.trim(),
        Price: price,
        price,
        Category: productCategories,
        Type: productForm.Type,
        ...(productForm.Type === "Quantity" ? { Min: minimum } : {}),
      };
      const batch = writeBatch(db);
      batch.set(doc(db, "Products", productID), sharedData, { merge: isEdit });
      const adminProductRef = doc(db, "productsAdmin", productID);
      batch.set(adminProductRef, {
        ...sharedData,
        costingPrice,
        stock,
      }, { merge: isEdit });
      await batch.commit();
      setAdminProducts((current) => [
        ...current.filter((product) => String(product.productID || product.id) !== productID),
        { ...sharedData, costingPrice, stock, id: productID, ref: adminProductRef },
      ].sort((a, b) => productTitle(a).localeCompare(productTitle(b))));
      setProductForm({
        Name_English: "",
        Name_Telugu: "",
        Name_Tinglish: "",
        Image_URL: "",
        Price: "",
        costingPrice: "",
        stock: "",
        Type: "Countable",
        Min: "",
      });
      setProductCategories([]);
      setEditingProductId("");
      setShowProductForm(false);
      toast.success(isEdit ? "Product updated" : "Product added");
    } catch {
      setProductError(
        "Could not save this product. Check Firestore permissions and try again.",
      );
    } finally {
      setSavingProduct(false);
    }
  };

  const downloadProductsCsv = () => {
    const lines = [PRODUCT_CSV_HEADERS.map(csvCell).join(",")];
    adminProducts.forEach((product) => {
      lines.push(
        [
          product.productID || product.id,
          product.Name_English,
          product.Name_Tinglish,
          product.Name_Telugu,
          product.Price ?? product.price,
          product.stock,
          product.costingPrice,
          product.Type === "Quantity" ? 1 : 0,
          product.Min,
          product.Image_URL || product.Image,
          (Array.isArray(product.Category) ? product.Category : []).join("|"),
        ]
          .map(csvCell)
          .join(","),
      );
    });
    const blob = new Blob([`\uFEFF${lines.join("\r\n")}`], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "products-template.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const uploadProductsCsv = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setSavingProduct(true);
    try {
      const rows = parseCsv(await file.text());
      if (rows.length < 2) throw new Error("CSV has no product rows.");
      const headers = rows[0].map((header) => header.trim().toLowerCase());
      const column = (...names) => names.map((name) => headers.indexOf(name.toLowerCase())).find((index) => index >= 0) ?? -1;
      const columns = {
        productID: column("productID"),
        english: column("Name_English"),
        tinglish: column("Name_Tinglish"),
        telugu: column("Name_Telugu"),
        price: column("price"),
        stock: column("stock"),
        cost: column("costingPrice", "costinPrice"),
        type: column("Quantity (1) / Countable (0)", "Quantity/Countable", "Type"),
        min: column("Min"),
        image: column("Image_URL"),
        category: column("category"),
      };
      if ([columns.english, columns.price, columns.stock, columns.cost, columns.type, columns.min, columns.category].some((index) => index < 0)) {
        throw new Error("CSV is missing required columns. Download a fresh template.");
      }
      const existingIds = new Set(adminProducts.map((product) => String(product.productID || product.id)));
      const importRows = [];
      let ignored = 0;
      rows.slice(1).forEach((row) => {
        const value = (index) => (index < 0 ? "" : String(row[index] ?? "").trim());
        const requestedId = value(columns.productID);
        if (requestedId && !existingIds.has(requestedId)) {
          ignored += 1;
          return;
        }
        const price = Number(value(columns.price));
        const stock = Number(value(columns.stock));
        const costingPrice = Number(value(columns.cost));
        const typeValue = value(columns.type).toLowerCase();
        const type = ["1", "quantity"].includes(typeValue) ? "Quantity" : "Countable";
        const minimum = value(columns.min) === "" ? null : Number(value(columns.min));
        const categoryText = value(columns.category);
        const Category = categoryText
          .split(/[|;,]/)
          .map((item) => item.trim())
          .filter(Boolean);
        const Name_English = value(columns.english);
        if (!Name_English || !Number.isFinite(price) || price < 0 || !Number.isInteger(stock) || stock < 0 || !Number.isFinite(costingPrice) || costingPrice < 0 || Category.length === 0 || (type === "Quantity" && (!Number.isInteger(minimum) || minimum <= 0))) {
          ignored += 1;
          return;
        }
        importRows.push({
          productID: requestedId,
          data: {
            Name_English,
            Name_Tinglish: value(columns.tinglish),
            Name_Telugu: value(columns.telugu),
            Image_URL: value(columns.image),
            Price: price,
            price,
            stock,
            costingPrice,
            Type: type,
            Category,
            ...(type === "Quantity" ? { Min: minimum } : {}),
          },
        });
      });
      if (!importRows.length) throw new Error("No valid new or existing product rows were found.");
      for (let offset = 0; offset < importRows.length; offset += 200) {
        const batch = writeBatch(db);
        importRows.slice(offset, offset + 200).forEach(({ productID: requestedId, data }) => {
          const productID = requestedId || doc(collection(db, "Products")).id;
          const isEdit = Boolean(requestedId);
          const productData = {
            ...data,
            productID,
            ...(!isEdit && data.Type === "Quantity" ? { Min: 1 } : {}),
          };
          const sharedData = {
            ...productData,
            stock: deleteField(),
            costingPrice: deleteField(),
            ...(isEdit && productData.Type !== "Quantity" ? { Min: deleteField() } : {}),
          };
          batch.set(
            doc(db, "Products", productID),
            isEdit ? sharedData : productData,
            { merge: isEdit },
          );
          batch.set(
            doc(db, "productsAdmin", productID),
            {
              ...productData,
              stock: data.stock,
              costingPrice: data.costingPrice,
              ...(isEdit && productData.Type !== "Quantity" ? { Min: deleteField() } : {}),
            },
            { merge: isEdit },
          );
        });
        await batch.commit();
      }
      await loadData();
      toast.success(`${importRows.length} product${importRows.length === 1 ? "" : "s"} imported${ignored ? `; ${ignored} row${ignored === 1 ? "" : "s"} ignored` : ""}.`);
    } catch (error) {
      toast.error(error.message || "Could not import products CSV.");
    } finally {
      setSavingProduct(false);
    }
  };

  const beginEditProduct = (product) => {
    setEditingProductId(String(product.productID || product.id));
    setProductForm({
      Name_English: product.Name_English || "",
      Name_Telugu: product.Name_Telugu || "",
      Name_Tinglish: product.Name_Tinglish || "",
      Image_URL: product.Image_URL || product.Image || "",
      Price: String(product.Price ?? product.price ?? ""),
      costingPrice: String(product.costingPrice ?? ""),
      stock: String(product.stock ?? ""),
      Type: product.Type || "Countable",
      Min: String(product.Min ?? ""),
    });
    setProductCategories(Array.isArray(product.Category) ? product.Category : []);
    setProductError("");
    setShowProductForm(true);
  };

  const counts = useMemo(() => {
    const result = Object.fromEntries(STATUSES.map((status) => [status, 0]));
    orders.forEach((order) => {
      if (result[order.status] !== undefined) result[order.status] += 1;
    });
    return result;
  }, [orders]);

  const costingByProductId = useMemo(
    () =>
      new Map(
        adminProducts.map((product) => [
          String(product.productID || product.id),
          product.costingPrice == null || product.costingPrice === ""
            ? null
            : Number.isFinite(Number(product.costingPrice))
              ? Number(product.costingPrice)
              : null,
        ]),
      ),
    [adminProducts],
  );
  const productRefsById = useMemo(
    () => new Map(adminProducts.map((product) => [String(product.productID || product.id), product.ref || doc(db, "productsAdmin", String(product.productID || product.id))])),
    [adminProducts],
  );
  const totalProfit = useMemo(() => {
    if (!profitFromDate && !profitToDate) return profitValue;
    const from = profitFromDate || "0000-00-00";
    const to = profitToDate || localDateKey();
    if (from > to) return 0;
    // Summing daily deltas is equivalent to cumulative gain(to) minus gain(day before from).
    return Object.entries(dailyProfits).reduce(
      (sum, [date, values]) =>
        date >= from && date <= to ? sum + numberOrZero(values.gain) : sum,
      0,
    );
  }, [dailyProfits, profitFromDate, profitToDate, profitValue]);
  const filteredOrders = useMemo(
    () =>
      orders.filter((order) => {
        const date = orderDate(order);
        const search = orderSearchFilter.trim().toLocaleLowerCase();
        const matchesCustomer =
          !search ||
          String(order.pickup_name || "").toLocaleLowerCase().includes(search) ||
          String(order.phone || order.phone_number || "").toLocaleLowerCase().includes(search);
        return (
          matchesCustomer &&
          (statusFilter === "all" || order.status === statusFilter) &&
          (!fromDate || (date && date >= fromDate)) &&
          (!toDate || (date && date <= toDate))
        );
      }),
    [fromDate, orderSearchFilter, orders, statusFilter, toDate],
  );
  const filteredAdminProducts = useMemo(() => {
    const query = productNameFilter.trim().toLocaleLowerCase();
    const stockThreshold = stockBelowFilter === "" ? null : Number(stockBelowFilter);
    return adminProducts.filter((product) => {
      const searchableNames = [
        product.Name_English,
        product.Name_Telugu,
        product.Name_Tinglish,
        product.name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase();
      const productCategories = Array.isArray(product.Category)
        ? product.Category
        : [];
      const stock = Number(product.stock);
      return (
        (!query || searchableNames.includes(query)) &&
        (productCategoryFilter === "all" ||
          productCategories.includes(productCategoryFilter)) &&
        (stockThreshold === null || (Number.isFinite(stock) && stock < stockThreshold)) &&
        (productTypeFilter === "all" || product.Type === productTypeFilter)
      );
    });
  }, [
    adminProducts,
    productCategoryFilter,
    productNameFilter,
    productTypeFilter,
    stockBelowFilter,
  ]);

  const addAdminOrderNote = async () => {
    const text = adminNoteDraft.trim();
    if (!selectedOrder || !text) return;
    setSavingAdminNote(true);
    const note = { text, created_at: new Date().toISOString() };
    try {
      await runTransaction(db, async (transaction) => {
        const snapshot = await transaction.get(selectedOrder.ref);
        if (!snapshot.exists()) throw new Error("Order no longer exists.");
        const noteUpdate = { admin_notes: arrayUnion(note) };
        transaction.set(selectedOrder.ref, noteUpdate, { merge: true });
        if (selectedOrder.phone) {
          transaction.set(
            doc(db, "db", selectedOrder.phone, "orders", selectedOrder.id),
            noteUpdate,
            { merge: true },
          );
        }
      });
      setOrders((current) =>
        current.map((order) =>
          order.id === selectedOrder.id
            ? { ...order, admin_notes: [...(order.admin_notes || []), note] }
            : order,
        ),
      );
      setSelectedOrder((current) =>
        current?.id === selectedOrder.id
          ? { ...current, admin_notes: [...(current.admin_notes || []), note] }
          : current,
      );
      setAdminNoteDraft("");
      toast.success("Note added to order");
    } catch (error) {
      toast.error(error.message || "Could not add note.");
    } finally {
      setSavingAdminNote(false);
    }
  };

  const saveStatus = async (order, status) => {
    setSavingStatus(true);
    try {
      const profitRef = doc(db, "Profit", "NetGain");
      const transactionResult = await runTransaction(db, async (transaction) => {
        const orderSnapshot = await transaction.get(order.ref);
        if (!orderSnapshot.exists()) throw new Error("Order no longer exists");
        const currentOrder = orderSnapshot.data();
        const profitSnapshot = await transaction.get(profitRef);
        const savedTotals = profitSnapshot.data() || {};
        let netGain = numberOrZero(savedTotals.gain ?? savedTotals.value);
        let netSelling = numberOrZero(savedTotals["selling price"]);
        let netCost = numberOrZero(savedTotals["cost price"]);
        let profitRecorded = currentOrder.profit_recorded === true;
        let orderProfitValue = Number(currentOrder.profit_amount || 0);
        let orderSellingValue = numberOrZero(currentOrder.profit_selling_price);
        let orderCostValue = numberOrZero(currentOrder.profit_cost_price);
        let deltaGain = 0;
        let deltaSelling = 0;
        let deltaCost = 0;
        let stockDeducted = currentOrder.stock_deducted === true;
        const completionDate =
          currentOrder.profit_date || (status === "Done" ? localDateKey() : localDateKey());
        const dailyRef = doc(db, "Profit", completionDate);
        const shouldAdjustStock = (status === "Done" && !stockDeducted) || (status !== "Done" && stockDeducted);
        const stockRequirements = new Map();

        if (shouldAdjustStock) {
          for (const item of currentOrder.items || []) {
            const productID = String(item.productID || item.id || "");
            if (!productID) throw new Error("An order item is missing its product ID.");
            const quantity = Number(item.quantity || 0);
            const existing = stockRequirements.get(productID) || { quantity: 0, unit: item.unit };
            existing.quantity += quantity;
            stockRequirements.set(productID, existing);
          }
        }
        const stockRefs = new Map([...stockRequirements.keys()].map((productID) => [productID, productRefsById.get(productID) || doc(db, "productsAdmin", productID)]));
        const stockSnapshots = new Map(await Promise.all([...stockRefs.entries()].map(async ([productID, ref]) => [productID, await transaction.get(ref)])));
        const dailySnapshot = await transaction.get(dailyRef);
        const dailyTotals = dailySnapshot.data() || {};
        let dailyGain = numberOrZero(dailyTotals.gain);
        let dailySelling = numberOrZero(dailyTotals["selling price"]);
        let dailyCost = numberOrZero(dailyTotals["cost price"]);
        const stockUpdates = [];

        if (status === "Done" && !profitRecorded) {
          orderProfitValue = orderProfit(currentOrder, costingByProductId);
          orderSellingValue = orderTotal(currentOrder);
          orderCostValue = orderCost(currentOrder, costingByProductId);
          deltaGain = orderProfitValue;
          deltaSelling = orderSellingValue;
          deltaCost = orderCostValue;
          profitRecorded = true;
        } else if (status !== "Done" && profitRecorded) {
          orderSellingValue = numberOrZero(currentOrder.profit_selling_price ?? orderTotal(currentOrder));
          orderCostValue = numberOrZero(currentOrder.profit_cost_price ?? (orderSellingValue - orderProfitValue));
          deltaGain = -orderProfitValue;
          deltaSelling = -orderSellingValue;
          deltaCost = -orderCostValue;
          orderProfitValue = 0;
          orderSellingValue = 0;
          orderCostValue = 0;
          profitRecorded = false;
        }
        netGain += deltaGain;
        netSelling += deltaSelling;
        netCost += deltaCost;
        dailyGain += deltaGain;
        dailySelling += deltaSelling;
        dailyCost += deltaCost;
        if (status === "Done" && !stockDeducted) {
          for (const [productID, requirement] of stockRequirements) {
            const productSnapshot = stockSnapshots.get(productID);
            if (!productSnapshot?.exists()) throw new Error(`Stock record missing for product ${productID}.`);
            const currentStock = Number(productSnapshot.data().stock);
            if (!Number.isFinite(currentStock)) throw new Error(`Stock is not set for product ${productID}.`);
            if (currentStock < requirement.quantity) throw new Error(`Not enough stock for product ${productID}.`);
            const stock = currentStock - requirement.quantity;
            transaction.update(stockRefs.get(productID), { stock });
            stockUpdates.push({ productID, stock });
          }
          stockDeducted = true;
        } else if (status !== "Done" && stockDeducted) {
          for (const [productID, requirement] of stockRequirements) {
            const productSnapshot = stockSnapshots.get(productID);
            if (!productSnapshot?.exists()) throw new Error(`Stock record missing for product ${productID}.`);
            const stock = Number(productSnapshot.data().stock || 0) + requirement.quantity;
            transaction.update(stockRefs.get(productID), { stock });
            stockUpdates.push({ productID, stock });
          }
          stockDeducted = false;
        }
        const orderUpdate = {
          status,
          profit_recorded: profitRecorded,
          profit_amount: orderProfitValue,
          profit_selling_price: orderSellingValue,
          profit_cost_price: orderCostValue,
          profit_date: completionDate,
          stock_deducted: stockDeducted,
        };
        transaction.set(order.ref, orderUpdate, { merge: true });
        if (order.phone)
          transaction.set(
            doc(db, "db", order.phone, "orders", order.id),
            orderUpdate,
            { merge: true },
          );
        if (deltaGain !== 0 || deltaSelling !== 0 || deltaCost !== 0) {
          transaction.set(
            profitRef,
            {
              "selling price": netSelling,
              "cost price": netCost,
              gain: netGain,
              value: deleteField(),
              updated_at: new Date().toISOString(),
            },
            { merge: true },
          );
          transaction.set(
            dailyRef,
            {
              "selling price": dailySelling,
              "cost price": dailyCost,
              gain: dailyGain,
              updated_at: new Date().toISOString(),
            },
            { merge: true },
          );
        }
        return {
          netGain,
          completionDate,
          daily: {
            "selling price": dailySelling,
            "cost price": dailyCost,
            gain: dailyGain,
          },
          stockUpdates,
        };
      });
      setProfitValue(transactionResult.netGain);
      setDailyProfits((current) => ({
        ...current,
        [transactionResult.completionDate]: transactionResult.daily,
      }));
      if (transactionResult.stockUpdates.length) {
        setAdminProducts((current) => current.map((product) => {
          const update = transactionResult.stockUpdates.find((entry) => entry.productID === String(product.productID || product.id));
          return update ? { ...product, stock: update.stock } : product;
        }));
      }
      setOrders((current) =>
        current.map((item) =>
          item.id === order.id ? { ...item, status } : item,
        ),
      );
      setSelectedOrder((current) =>
        current?.id === order.id ? { ...current, status } : current,
      );
      toast.success("Order status updated");
    } catch (error) {
      toast.error(error.message || "Could not update order status.");
    } finally {
      setSavingStatus(false);
    }
  };

  const openWhatsAppForStatus = (order, status) => {
    if (status !== "In Review" && status !== "Ready" && status !== "Done") return;
    const customerPhone = String(order.phone || order.phone_number || "").replace(/\D/g, "");
    if (!customerPhone) {
      toast.error("This order does not have a customer phone number.");
      return;
    }
    const whatsappPhone = customerPhone.length === 10
      ? `91${customerPhone}`
      : customerPhone;
    const message =
  status === "In Review"
    ? [
        "Hi,",
        "",
        "We received an order from this number,",
        "",
        `pickup name : ${order.pickup_name || ""}`,
        `pickup time : ${formatPickup(order.pickup_time)}`,
        `No of items : ${(order.items || []).length}`,
        `total bill : ${currency(orderTotal(order))}`,
        "",
        `your order ID : ${order.id}`,
        "",
        `Track your order here : https://kedarisettisatwik.github.io/ksr/#/order/${order.id}`,
        "",
        'Reply "yes" to confirm your order.',
      ].join("\n")
    : status === "Done"
    ? [
        "Hi,",
        "",
        "This is confirmation message that your order was delivered.",
      ].join("\n")
    : [
        "Hi,",
        "",
        "Your order was packed and ready. Please visit store and take your order.",
        "",
        "Shop Name : Kedarisetti Subarao & C.0",
        "Contact Number : 9290864905",
        "Address : 33-2-2, Main market, near glass house, sai baba temple",
        `phone number : ${order.phone || order.phone_number}`,
        "",
        "Thanks for shopping with us.",
      ].join("\n");
    const url = `https://wa.me/${whatsappPhone}?text=${encodeURIComponent(message)}`;
    // Reusing this named browsing context opens a new tab once, then navigates
    // the same tab to each subsequent customer's WhatsApp chat.
    window.open(url, "ksrWhatsApp");
  };

  if (!authReady)
    return (
      <main className="admin-app admin-auth-state">
        <Toaster position="top-center" />
        <p>Checking admin sign-in…</p>
      </main>
    );

  if (!currentUser)
    return (
      <main className="admin-app admin-login-page">
        <Toaster position="top-center" />
        <header className="admin-header">
          <Link to="/" className="admin-brand">
            <img src={logo} alt="KSR" />
            <span>Store management</span>
          </Link>
        </header>
        <section className="admin-login-card">
          <span className="admin-eyebrow">RESTRICTED AREA</span>
          <h1>Admin sign in</h1>
          <p>Sign in with your authorized admin account to continue.</p>
          <form onSubmit={handleSignIn}>
            <label>
              Username / email
              <input
                type="email"
                autoComplete="username"
                required
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="admin@example.com"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter password"
              />
            </label>
            {signInError && (
              <p className="admin-login-error" role="alert">
                {signInError}
              </p>
            )}
            <button
              className="admin-login-submit"
              type="submit"
              disabled={signingIn}
            >
              {signingIn ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </section>
      </main>
    );

  return (
    <main className="admin-app">
      <Toaster position="top-center" />
      <header className="admin-header">
        <Link to="/" className="admin-brand">
          <img src={logo} alt="KSR" />
          <span>Store management</span>
        </Link>
        <div className="admin-header-actions">
          <button
            className="admin-refresh"
            onClick={loadData}
            disabled={loading}
          >
            {loading ? "Refreshing…" : "↻ Refresh"}
          </button>
          <button className="admin-logout" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </header>
      <section className="admin-heading">
        <div>
          <span className="admin-eyebrow">KSR RETAIL</span>
          <h1>Admin dashboard</h1>
          <p>Orders and store activity at a glance.</p>
        </div>
      </section>
      <nav className="admin-tabs" aria-label="Admin sections">
        <button
          className={activeTab === "dashboard" ? "active" : ""}
          onClick={() => setActiveTab("dashboard")}
        >
          Dashboard
        </button>
        <button
          className={activeTab === "orders" ? "active" : ""}
          onClick={() => setActiveTab("orders")}
        >
          Orders <span>{orders.length}</span>
        </button>
        <button
          className={activeTab === "categories" ? "active" : ""}
          onClick={() => setActiveTab("categories")}
        >
          Categories <span>{categories.length}</span>
        </button>
        <button
          className={activeTab === "products" ? "active" : ""}
          onClick={() => setActiveTab("products")}
        >
          Products <span>{adminProducts.length}</span>
        </button>
      </nav>

      {loadError && (
        <div className="admin-error" role="alert">
          {loadError}
          <button onClick={loadData}>Retry</button>
        </div>
      )}
      {activeTab === "dashboard" ? (
        <section className="admin-content">
          <div className="metric-grid">
            <article className="metric-card users-metric">
              <span>Total users</span>
              <strong>{loading ? "—" : usersCount}</strong>
              <small>Registered customers</small>
              <i>♙</i>
            </article>
            <article className="metric-card profit-metric">
              <span>Total profit</span>
              <strong>{loading ? "—" : currency(totalProfit)}</strong>
              <small>Done orders · price less product cost</small>
              <div className="profit-date-filters">
                <label>
                  From
                  <input
                    type="date"
                    value={profitFromDate}
                    max={profitToDate || undefined}
                    onChange={(event) => setProfitFromDate(event.target.value)}
                  />
                </label>
                <label>
                  To
                  <input
                    type="date"
                    value={profitToDate}
                    min={profitFromDate || undefined}
                    onChange={(event) => setProfitToDate(event.target.value)}
                  />
                </label>
                {(profitFromDate || profitToDate) && (
                  <button
                    type="button"
                    onClick={() => {
                      setProfitFromDate("");
                      setProfitToDate("");
                    }}
                  >
                    Clear
                  </button>
                )}
              </div>
              <i>₹</i>
            </article>
          </div>
          <div className="admin-section-title">
            <div>
              <span className="admin-eyebrow">ORDER PIPELINE</span>
              <h2>Orders by status</h2>
            </div>
            <button
              className="admin-link-button"
              onClick={() => setActiveTab("orders")}
            >
              View all orders →
            </button>
          </div>
          <div className="status-metric-grid">
            {STATUSES.map((status) => (
              <button
                key={status}
                className={`status-metric status-${status === "order still in review" ? "pending" : status === "In Review" ? "review" : status === "order in progress" ? "progress" : status.toLowerCase()}`}
                onClick={() => {
                  setStatusFilter(status);
                  setActiveTab("orders");
                }}
              >
                <span>{STATUS_LABELS[status]}</span>
                <strong>{loading ? "—" : counts[status]}</strong>
                <small>Orders</small>
              </button>
            ))}
          </div>
          <div className="recent-orders">
            <div className="admin-section-title">
              <div>
                <span className="admin-eyebrow">LATEST ACTIVITY</span>
                <h2>Recent orders</h2>
              </div>
            </div>
            {loading ? (
              <p className="admin-empty">Loading orders…</p>
            ) : orders.length ? (
              <div className="recent-list">
                {orders.slice(0, 5).map((order) => (
                  <button
                    className="recent-order"
                    key={order.id}
                    onClick={() => setSelectedOrder(order)}
                  >
                    <span className="recent-order-main">
                      <strong>
                        {order.pickup_name || "Customer"}{" "}
                        <small>· {order.phone}</small>
                      </strong>
                      <small>
                        Pickup: {order.pickup_time ? formatPickup(order.pickup_time) : "Not scheduled"} · #
                        {order.id.slice(0, 7)}
                      </small>
                    </span>
                    <span className="recent-order-end">
                      <b>{currency(orderTotal(order))}</b>
                      <em
                        className={`status-pill ${statusClass(order.status)}`}
                      >
                        {STATUS_LABELS[order.status] ||
                          order.status ||
                          "Pending"}
                      </em>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="admin-empty">No orders found yet.</p>
            )}
          </div>
        </section>
      ) : activeTab === "orders" ? (
        <section className="admin-content orders-content">
          <div className="orders-title-row">
            <div>
              <span className="admin-eyebrow">FULFILLMENT</span>
              <h2>
                Orders <small>{filteredOrders.length}</small>
              </h2>
            </div>
          </div>
          <div className="order-filters">
            <label>
              Customer name / phone
              <input
                type="search"
                value={orderSearchFilter}
                onChange={(event) => setOrderSearchFilter(event.target.value)}
                placeholder="Search customer or phone"
              />
            </label>
            <label>
              Status
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">All statuses</option>
                {STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              From date
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </label>
            <label>
              To date
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </label>
            <button
              onClick={() => {
                setStatusFilter("all");
                setFromDate("");
                setToDate("");
                setOrderSearchFilter("");
              }}
            >
              Clear filters
            </button>
          </div>
          {loading ? (
            <p className="admin-empty">Loading orders…</p>
          ) : filteredOrders.length ? (
            <div className="orders-table-wrap">
              <table className="orders-table">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Customer</th>
                    <th>Pickup</th>
                    <th>Total</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((order) => (
                    <tr
                      key={order.id}
                      onClick={() => setSelectedOrder(order)}
                      tabIndex="0"
                      onKeyDown={(e) =>
                        e.key === "Enter" && setSelectedOrder(order)
                      }
                    >
                      <td>#{order.id.slice(0, 7)}</td>
                      <td>
                        <strong>{order.pickup_name || "Customer"}</strong>
                        <small>{order.phone}</small>
                      </td>
                      <td>{formatPickup(order.pickup_time)}</td>
                      <td>
                        <strong>{currency(orderTotal(order))}</strong>
                      </td>
                      <td>
                        <em
                          className={`status-pill ${statusClass(order.status)}`}
                        >
                          {STATUS_LABELS[order.status] ||
                            order.status ||
                            "Pending"}
                        </em>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="admin-empty">No orders match these filters.</p>
          )}
        </section>
      ) : activeTab === "categories" ? (
        <section className="admin-content categories-content">
          <div className="categories-heading">
            <div>
              <span className="admin-eyebrow">STORE CATALOG</span>
              <h2>
                Categories <small>{categories.length}</small>
              </h2>
            </div>
            <button
              className="new-category-button"
              onClick={() => {
                setCategoryError("");
                setShowCategoryForm(true);
              }}
            >
              ＋ New
            </button>
          </div>
          {loading ? (
            <p className="admin-empty">Loading categories…</p>
          ) : categories.length ? (
            <div className="admin-category-grid">
              {categories.map((item) => (
                <article className="admin-category-card" key={item.id}>
                  <span className="admin-category-icon">
                    {item.Icon || "◉"}
                  </span>
                  <div>
                    <strong>{item.Type || "Untitled category"}</strong>
                    <small>
                      {adminProducts.filter((product) =>
                        Array.isArray(product.Category) &&
                        product.Category.includes(item.Type),
                      ).length} products
                    </small>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="admin-empty">
              No categories found. Add the first one.
            </p>
          )}
        </section>
      ) : (
        <section className="admin-content admin-products-content">
          <div className="categories-heading">
            <div>
              <span className="admin-eyebrow">INVENTORY</span>
              <h2>
                Products <small>{adminProducts.length}</small>
              </h2>
            </div>
            <button
              className="new-category-button"
              onClick={() => {
                setEditingProductId("");
                setProductForm({ Name_English: "", Name_Telugu: "", Name_Tinglish: "", Image_URL: "", Price: "", costingPrice: "", stock: "", Type: "Countable", Min: "" });
                setProductCategories([]);
                setProductError("");
                setShowProductForm(true);
              }}
            >
              ＋ New
            </button>
          </div>
          <div className="product-filters">
            <label>
              Product name
              <input
                type="search"
                value={productNameFilter}
                onChange={(event) => setProductNameFilter(event.target.value)}
                placeholder="Search by name"
              />
            </label>
            <label>
              Category
              <select
                value={productCategoryFilter}
                onChange={(event) => setProductCategoryFilter(event.target.value)}
              >
                <option value="all">All categories</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.Type}>
                    {category.Type}
                  </option>
                ))}
              </select>
            </label>
            <label style={{"width":"100px" }}>
              Stock less than
              <input
                type="number"
                min="0"
                value={stockBelowFilter}
                onChange={(event) => setStockBelowFilter(event.target.value)}
                placeholder="No limit"
              />
            </label>
            <label>
              Product type
              <select
                value={productTypeFilter}
                onChange={(event) => setProductTypeFilter(event.target.value)}
              >
                <option value="all">All types</option>
                <option value="Quantity">Quantity</option>
                <option value="Countable">Countable</option>
              </select>
            </label>
            <button
              type="button"
              onClick={() => {
                setProductNameFilter("");
                setProductCategoryFilter("all");
                setStockBelowFilter("");
                setProductTypeFilter("all");
              }}
            >
              Clear filters
            </button>
          </div>
          {loading ? (
            <p className="admin-empty">Loading products…</p>
          ) : filteredAdminProducts.length ? (
            <div className="admin-products-grid">
              {filteredAdminProducts.map((product) => (
                <article className="admin-product-card" key={product.id}>
                  <div className="admin-product-left">
                    <div className="admin-product-image">
                      {product.Image || product.Image_URL ? (
                        <img
                          src={product.Image || product.Image_URL}
                          alt={productTitle(product)}
                        />
                      ) : (
                        <span>🛍️</span>
                      )}
                    </div>
                    <div className="admin-product-info">
                      <div className="admin-product-title">
                        <h3>{productTitle(product)}</h3>
                        <small>
                          Product ID: {product.productID || product.id}
                        </small>
                      </div>
                      <div className="admin-product-names">
                        {product.Name_Telugu && (
                          <p>
                            <span>Telugu</span>
                            {product.Name_Telugu}
                          </p>
                        )}
                        {product.Name_Tinglish && (
                          <p>
                            <span>Tinglish</span>
                            {product.Name_Tinglish}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="admin-product-right" style={{ margin:"0 10px" }}>
                      <div className="admin-product-fields">
                        <p>
                          <span>Price</span>
                          <strong>{currency(product.Price)}</strong>
                        </p>
                        <p>
                          <span>Costing price</span>
                          <strong>
                            {product.costingPrice == null
                              ? "—"
                              : currency(product.costingPrice)}
                          </strong>
                        </p>
                        <p>
                          <span>Stock</span>
                          <strong>{product.stock ?? "—"}{product.Type === "Quantity" && product.stock != null ? " g" : ""}</strong>
                        </p>
                        <p>
                          <span>Type</span>
                          <strong>{product.Type || "—"}</strong>
                        </p>
                      </div>
                      {Array.isArray(product.Category) && (
                        <div className="admin-product-categories">
                          {product.Category.map((item) => (
                            <span key={item}>{item}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <button className="product-edit-button" onClick={() => beginEditProduct(product)}>Edit</button>
                </article>
              ))}
            </div>
          ) : (
            <p className="admin-empty">
              {adminProducts.length
                ? "No products match these filters."
                : "No products found in ProductsAdmin."}
            </p>
          )}
        </section>
      )}

      {showCategoryForm && (
        <div
          className="admin-modal-backdrop"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setShowCategoryForm(false)
          }
        >
          <section
            className="category-modal"
            role="dialog"
            aria-modal="true"
            aria-label="New category"
          >
            <header>
              <div>
                <span className="admin-eyebrow">STORE CATALOG</span>
                <h2>New category</h2>
              </div>
              <button
                className="modal-close"
                onClick={() => setShowCategoryForm(false)}
                aria-label="Close"
              >
                ×
              </button>
            </header>
            <form onSubmit={createCategory}>
              <label>
                Type
                <input
                  autoFocus
                  required
                  value={categoryType}
                  onChange={(event) => setCategoryType(event.target.value)}
                  placeholder="e.g. Soaps"
                />
              </label>
              <label>
                Icon
                <input
                  required
                  value={categoryIcon}
                  onChange={(event) => setCategoryIcon(event.target.value)}
                  placeholder="e.g. 🧼"
                />
              </label>
              <small className="category-icon-hint">
                Enter an emoji or icon text to show beside the category.
              </small>
              {categoryError && (
                <p className="admin-login-error" role="alert">
                  {categoryError}
                </p>
              )}
              <button
                className="admin-login-submit"
                type="submit"
                disabled={savingCategory}
              >
                {savingCategory ? "Saving…" : "Create category"}
              </button>
            </form>
          </section>
        </div>
      )}

      {showProductForm && (
        <div
          className="admin-modal-backdrop"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setShowProductForm(false)
          }
        >
          <section
            className="product-modal"
            role="dialog"
            aria-modal="true"
            aria-label={editingProductId ? "Edit product" : "New product"}
          >
            <header>
              <div>
                <span className="admin-eyebrow">INVENTORY</span>
                <h2>{editingProductId ? "Edit product" : "New product"}</h2>
              </div>
              <button
                className="modal-close"
                onClick={() => setShowProductForm(false)}
                aria-label="Close"
              >
                ×
              </button>
            </header>
            <section className="product-add-bulk" style={{ "margin":"20px 0" }}>
          <p style={{"fontSize":"12px"}}><span className="products-template-download" role="button" tabIndex={0} onClick={downloadProductsCsv} onKeyDown={(event) => event.key === "Enter" && downloadProductsCsv()} style={{ "textDecoration":"underline", "cursor":"pointer", "color":"#42a742"}}>Download template</span> and fill it with your product data and <span className="product-template-upload" role="button" tabIndex={0} onClick={() => csvUploadRef.current?.click()} onKeyDown={(event) => event.key === "Enter" && csvUploadRef.current?.click()} style={{ "textDecoration":"underline", "cursor":"pointer", "color":"#42a742"}}>upload</span> it here.
                <input ref={csvUploadRef} type="file" accept=".csv,text/csv" onChange={uploadProductsCsv} hidden />
              </p>
            </section>
            <form onSubmit={createProduct}>
              <div className="product-form-grid">
                <label>
                  English name
                  <input
                    autoFocus
                    required
                    value={productForm.Name_English}
                    onChange={(event) =>
                      setProductForm({
                        ...productForm,
                        Name_English: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Telugu name
                  <input
                    value={productForm.Name_Telugu}
                    onChange={(event) =>
                      setProductForm({
                        ...productForm,
                        Name_Telugu: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Tinglish name
                  <input
                    value={productForm.Name_Tinglish}
                    onChange={(event) =>
                      setProductForm({
                        ...productForm,
                        Name_Tinglish: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Image URL
                  <input
                    type="url"
                    value={productForm.Image_URL}
                    onChange={(event) =>
                      setProductForm({
                        ...productForm,
                        Image_URL: event.target.value,
                      })
                    }
                    placeholder="https://…"
                  />
                </label>
                <label>
                  Price per unit / kg
                  <input
                    required
                    type="number"
                    min="0"
                    step="0.01"
                    value={productForm.Price}
                    onChange={(event) =>
                      setProductForm({
                        ...productForm,
                        Price: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Costing price per unit / kg
                  <input
                    required
                    type="number"
                    min="0"
                    step="0.01"
                    value={productForm.costingPrice}
                    onChange={(event) =>
                      setProductForm({
                        ...productForm,
                        costingPrice: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Stock {productForm.Type === "Quantity" ? "(grams)" : "(units)"}
                  <input
                    required
                    type="number"
                    min="0"
                    step="1"
                    value={productForm.stock}
                    onChange={(event) =>
                      setProductForm({
                        ...productForm,
                        stock: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Type
                  <select
                    value={productForm.Type}
                    onChange={(event) =>
                      setProductForm({
                        ...productForm,
                        Type: event.target.value,
                      })
                    }
                  >
                    <option>Countable</option>
                    <option>Quantity</option>
                  </select>
                </label>
                {productForm.Type === "Quantity" && (
                  <label>
                    Minimum quantity (grams)
                    <input
                      required
                      type="number"
                      min="1"
                      step="1"
                      value={productForm.Min}
                      onChange={(event) =>
                        setProductForm({
                          ...productForm,
                          Min: event.target.value,
                        })
                      }
                    />
                  </label>
                )}
              </div>
              <fieldset className="product-category-picker">
                <legend>Categories</legend>
                {categories.length ? (
                  categories.map((item) => (
                    <label key={item.id}>
                      <input
                        type="checkbox"
                        checked={productCategories.includes(item.Type)}
                        onChange={(event) =>
                          setProductCategories(
                            event.target.checked
                              ? [...productCategories, item.Type]
                              : productCategories.filter(
                                  (type) => type !== item.Type,
                                ),
                          )
                        }
                      />
                      {item.Type}
                    </label>
                  ))
                ) : (
                  <small>No categories available. Add a category first.</small>
                )}
              </fieldset>
              {productError && (
                <p className="admin-login-error" role="alert">
                  {productError}
                </p>
              )}
              <button
                className="admin-login-submit"
                type="submit"
                disabled={savingProduct}
              >
                {savingProduct ? "Saving…" : editingProductId ? "Save changes" : "Create product"}
              </button>
            </form>
          </section>
        </div>
      )}

      {selectedOrder && (
        <div
          className="admin-modal-backdrop"
          onMouseDown={(e) =>
            e.target === e.currentTarget && setSelectedOrder(null)
          }
        >
          <section
            className="order-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Order details"
          >
            <header>
              <div>
                <span className="admin-eyebrow">ORDER DETAILS</span>
                <h2>#{selectedOrder.id}</h2>
              </div>
              <button
                className="modal-close"
                onClick={() => setSelectedOrder(null)}
                aria-label="Close"
              >
                ×
              </button>
            </header>
            <div className="order-customer">
              <div>
                <small>Customer phone</small>
                <a href={`tel:${selectedOrder.phone}`}>
                  {selectedOrder.phone || "Not available"}
                </a>
              </div>
              <div>
                <small>Order date</small>
                <strong>{orderDate(selectedOrder) || "Not available"}</strong>
              </div>
            </div>
            <div className="order-customer">
              <div>
                <small>Pickup person</small>
                <strong>{selectedOrder.pickup_name || "Not provided"}</strong>
              </div>
              <div>
                <small>Pickup time</small>
                <strong>{formatPickup(selectedOrder.pickup_time)}</strong>
              </div>
            </div>
            <label className="status-editor">
              Order status
              <select
                disabled={savingStatus}
                value={selectedOrder.status || STATUSES[0]}
                onChange={(e) => {
                  const nextStatus = e.target.value;
                  openWhatsAppForStatus(selectedOrder, nextStatus);
                  saveStatus(selectedOrder, nextStatus);
                }}
              >
                {STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </label>
            
            <div className="modal-items">
              <h3>Items ({selectedOrder.items?.length || 0})</h3>
              {(selectedOrder.items || []).map((item, index) => (
                <div className="modal-item" key={item.id || index}>
                  <span>
                    <strong>{item.name || "Product"}</strong>
                    <small>
                      {item.quantity}
                      {item.unit === "g" ? " g" : " unit"} ×{" "}
                      {currency(item.price)}
                      {item.unit === "g" ? " / kg" : ""}
                    </small>
                  </span>
                  <b>{currency(lineTotal(item))}</b>
                </div>
              ))}
            </div>
            <div className="modal-total">
              <span>Order total</span>
              <strong>{currency(orderTotal(selectedOrder))}</strong>
            </div>
            <section className="admin-order-notes">
              <h3>Customer notes</h3>
              <p>{selectedOrder.notes || selectedOrder.note || "No customer notes"}</p>
              <h3>Admin notes</h3>
              {selectedOrder.admin_notes?.length ? (
                <ul>
                  {selectedOrder.admin_notes.map((note, index) => (
                    <li key={`${note.created_at || "note"}-${index}`}>
                      <span>{note.text || note}</span>
                      {note.created_at && (
                        <small>{new Date(note.created_at).toLocaleString()}</small>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No admin notes yet.</p>
              )}
              <label>
                Add a note
                <textarea
                  rows={3}
                  value={adminNoteDraft}
                  onChange={(event) => setAdminNoteDraft(event.target.value)}
                  placeholder="Add a new note; saved notes cannot be edited"
                />
              </label>
              <button
                type="button"
                className="admin-login-submit"
                disabled={savingAdminNote || !adminNoteDraft.trim()}
                onClick={addAdminOrderNote}
              >
                {savingAdminNote ? "Adding note…" : "Add note"}
              </button>
            </section>
          </section>
        </div>
      )}
    </main>
  );
}

function statusClass(status) {
  if (status === "In Review") return "pill-review";
  if (status === "order in progress") return "pill-progress";
  if (status === "Ready") return "pill-ready";
  if (status === "Done") return "pill-done";
  return "pill-pending";
}

function formatPickup(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export default AdminDashboard;
