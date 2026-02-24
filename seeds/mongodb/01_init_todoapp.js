db = db.getSiblingDB('todoapp');

db.customers.drop();
db.products.drop();
db.categories.drop();
db.orders.drop();
db.reviews.drop();
db.inventory.drop();
db.suppliers.drop();
db.all_bson_types.drop();
db.null_patterns.drop();
db.unicode_samples.drop();
db.numeric_extremes.drop();
db.nested_documents.drop();
db.array_examples.drop();
db.large_collection.drop();

db.customers.insertMany([
  {
    _id: ObjectId("64a1b2c3d4e5f6789abcdef0"),
    email: "alice.johnson@email.com",
    passwordHash: "$2b$12$LQv3c1yqBwEHbNkZxK7Uru",
    firstName: "Alice",
    lastName: "Johnson",
    phone: "+1-555-0101",
    dateOfBirth: new Date("1985-03-15"),
    gender: "F",
    isActive: true,
    isVerified: true,
    loyaltyPoints: NumberInt(2500),
    preferences: { theme: "dark", newsletter: true, language: "en" },
    metadata: { tier: "gold", source: "organic" },
    addresses: [
      { type: "both", streetLine1: "123 Main Street", streetLine2: "Apt 4B", city: "New York", state: "NY", postalCode: "10001", country: "US", isDefault: true }
    ],
    createdAt: new Date("2023-01-15T10:30:00Z"),
    updatedAt: new Date(),
    lastLoginAt: new Date()
  },
  {
    _id: ObjectId("64a1b2c3d4e5f6789abcdef1"),
    email: "bob.smith@email.com",
    passwordHash: "$2b$12$LQv3c1yqBwEHbNkZxK7Uru",
    firstName: "Bob",
    lastName: "Smith",
    phone: "+1-555-0102",
    dateOfBirth: new Date("1990-07-22"),
    gender: "M",
    isActive: true,
    isVerified: true,
    loyaltyPoints: NumberInt(1200),
    preferences: { theme: "light", newsletter: false, language: "en" },
    metadata: { tier: "silver", source: "referral" },
    addresses: [
      { type: "both", streetLine1: "789 Oak Avenue", city: "Los Angeles", state: "CA", postalCode: "90001", country: "US", isDefault: true }
    ],
    createdAt: new Date("2023-02-20T14:45:00Z"),
    updatedAt: new Date(),
    lastLoginAt: new Date(Date.now() - 86400000)
  },
  {
    _id: ObjectId("64a1b2c3d4e5f6789abcdef2"),
    email: "carol.williams@email.com",
    passwordHash: "$2b$12$LQv3c1yqBwEHbNkZxK7Uru",
    firstName: "Carol",
    lastName: "Williams",
    phone: "+1-555-0103",
    dateOfBirth: new Date("1978-11-08"),
    gender: "F",
    isActive: true,
    isVerified: false,
    loyaltyPoints: NumberInt(500),
    preferences: { theme: "auto", newsletter: true, language: "es" },
    metadata: { tier: "bronze", source: "ads" },
    addresses: [
      { type: "billing", streetLine1: "321 Pine Road", city: "Chicago", state: "IL", postalCode: "60601", country: "US", isDefault: true }
    ],
    createdAt: new Date("2023-03-10T09:15:00Z"),
    updatedAt: new Date(),
    lastLoginAt: new Date(Date.now() - 432000000)
  },
  {
    _id: ObjectId("64a1b2c3d4e5f6789abcdef3"),
    email: "david.brown@email.com",
    passwordHash: "$2b$12$LQv3c1yqBwEHbNkZxK7Uru",
    firstName: "David",
    lastName: "Brown",
    phone: "+1-555-0104",
    dateOfBirth: new Date("1995-01-30"),
    gender: "M",
    isActive: true,
    isVerified: true,
    loyaltyPoints: NumberInt(8500),
    preferences: { theme: "dark", newsletter: true, language: "en" },
    metadata: { tier: "platinum", source: "organic" },
    addresses: [
      { type: "both", streetLine1: "987 Cedar Lane", city: "Houston", state: "TX", postalCode: "77001", country: "US", isDefault: true }
    ],
    createdAt: new Date("2022-11-05T16:20:00Z"),
    updatedAt: new Date(),
    lastLoginAt: new Date(Date.now() - 1800000)
  },
  {
    _id: ObjectId("64a1b2c3d4e5f6789abcdef4"),
    email: "emma.davis@email.com",
    passwordHash: "$2b$12$LQv3c1yqBwEHbNkZxK7Uru",
    firstName: "Emma",
    lastName: "Davis",
    phone: "+1-555-0105",
    dateOfBirth: new Date("1988-09-12"),
    gender: "F",
    isActive: true,
    isVerified: true,
    loyaltyPoints: NumberInt(3200),
    preferences: { theme: "light", newsletter: false, language: "fr" },
    metadata: { tier: "gold", source: "social" },
    addresses: [
      { type: "both", streetLine1: "147 Maple Drive", streetLine2: "Floor 2", city: "Phoenix", state: "AZ", postalCode: "85001", country: "US", isDefault: true }
    ],
    createdAt: new Date("2023-04-18T11:00:00Z"),
    updatedAt: new Date(),
    lastLoginAt: new Date(Date.now() - 10800000)
  }
]);

db.categories.insertMany([
  { _id: ObjectId("64a1b2c3d4e5f678aaaa0001"), name: "Electronics", slug: "electronics", description: "Electronic devices and accessories", parentId: null, isActive: true, sortOrder: NumberInt(1) },
  { _id: ObjectId("64a1b2c3d4e5f678aaaa0002"), name: "Clothing", slug: "clothing", description: "Apparel and fashion items", parentId: null, isActive: true, sortOrder: NumberInt(2) },
  { _id: ObjectId("64a1b2c3d4e5f678aaaa0003"), name: "Home & Garden", slug: "home-garden", description: "Home improvement and garden supplies", parentId: null, isActive: true, sortOrder: NumberInt(3) },
  { _id: ObjectId("64a1b2c3d4e5f678aaaa0004"), name: "Sports & Outdoors", slug: "sports-outdoors", description: "Sports equipment and outdoor gear", parentId: null, isActive: true, sortOrder: NumberInt(4) },
  { _id: ObjectId("64a1b2c3d4e5f678aaaa0005"), name: "Books & Media", slug: "books-media", description: "Books, music, and movies", parentId: null, isActive: true, sortOrder: NumberInt(5) },
  { _id: ObjectId("64a1b2c3d4e5f678aaaa0006"), name: "Smartphones", slug: "smartphones", description: "Mobile phones and accessories", parentId: ObjectId("64a1b2c3d4e5f678aaaa0001"), isActive: true, sortOrder: NumberInt(1) },
  { _id: ObjectId("64a1b2c3d4e5f678aaaa0007"), name: "Laptops", slug: "laptops", description: "Laptop computers and accessories", parentId: ObjectId("64a1b2c3d4e5f678aaaa0001"), isActive: true, sortOrder: NumberInt(2) },
  { _id: ObjectId("64a1b2c3d4e5f678aaaa0008"), name: "Audio", slug: "audio", description: "Headphones, speakers, and audio equipment", parentId: ObjectId("64a1b2c3d4e5f678aaaa0001"), isActive: true, sortOrder: NumberInt(3) },
  { _id: ObjectId("64a1b2c3d4e5f678aaaa0009"), name: "Gaming", slug: "gaming", description: "Video games and gaming accessories", parentId: ObjectId("64a1b2c3d4e5f678aaaa0001"), isActive: true, sortOrder: NumberInt(4) }
]);

db.suppliers.insertMany([
  { _id: ObjectId("64a1b2c3d4e5f678bbbb0001"), companyName: "TechWorld Inc.", contactName: "John Tech", contactEmail: "john@techworld.com", contactPhone: "+1-800-TECH-001", address: "100 Silicon Valley Blvd, San Jose, CA 95110", country: "US", isActive: true, rating: NumberDecimal("4.75") },
  { _id: ObjectId("64a1b2c3d4e5f678bbbb0002"), companyName: "Fashion Forward Ltd.", contactName: "Maria Style", contactEmail: "maria@fashionforward.com", contactPhone: "+1-800-FASH-002", address: "200 Fashion Ave, New York, NY 10018", country: "US", isActive: true, rating: NumberDecimal("4.50") },
  { _id: ObjectId("64a1b2c3d4e5f678bbbb0003"), companyName: "HomeGoods Global", contactName: "Robert Home", contactEmail: "robert@homegoods.com", contactPhone: "+1-800-HOME-003", address: "300 Comfort Lane, Chicago, IL 60601", country: "US", isActive: true, rating: NumberDecimal("4.25") }
]);

db.products.insertMany([
  {
    _id: ObjectId("64a1b2c3d4e5f678cccc0001"),
    sku: "PHONE-001",
    name: "ProMax Smartphone X",
    slug: "promax-smartphone-x",
    description: "The latest flagship smartphone with advanced AI capabilities, 6.7\" OLED display, and 5G connectivity.",
    shortDescription: "Flagship 5G smartphone with AI features",
    categoryId: ObjectId("64a1b2c3d4e5f678aaaa0006"),
    supplierId: ObjectId("64a1b2c3d4e5f678bbbb0001"),
    price: NumberDecimal("999.99"),
    costPrice: NumberDecimal("650.00"),
    compareAtPrice: NumberDecimal("1199.99"),
    currency: "USD",
    weightKg: NumberDecimal("0.195"),
    dimensions: { length: 16.5, width: 7.8, height: 0.8, unit: "cm" },
    isActive: true,
    isFeatured: true,
    isDigital: false,
    taxRate: NumberDecimal("8.25"),
    ratingAvg: NumberDecimal("4.5"),
    ratingCount: NumberInt(127),
    tags: ["smartphone", "5G", "flagship", "AI"],
    attributes: { color: "Midnight Black", storage: "256GB", ram: "12GB", screenSize: "6.7 inches" },
    images: [{ url: "https://cdn.example.com/products/phone-001-1.jpg", alt: "Front view" }],
    inventory: { totalStock: NumberInt(225), reservedStock: NumberInt(17), warehouseBreakdown: { MAIN: NumberInt(150), WEST: NumberInt(75) } },
    createdAt: new Date("2024-01-15T10:00:00Z"),
    updatedAt: new Date()
  },
  {
    _id: ObjectId("64a1b2c3d4e5f678cccc0002"),
    sku: "LAPTOP-001",
    name: "UltraBook Pro 15",
    slug: "ultrabook-pro-15",
    description: "Premium ultrabook with Intel Core i9, 32GB RAM, 1TB SSD, and stunning 4K OLED display.",
    shortDescription: "Premium 15\" ultrabook for professionals",
    categoryId: ObjectId("64a1b2c3d4e5f678aaaa0007"),
    supplierId: ObjectId("64a1b2c3d4e5f678bbbb0001"),
    price: NumberDecimal("1899.99"),
    costPrice: NumberDecimal("1200.00"),
    compareAtPrice: NumberDecimal("2199.99"),
    currency: "USD",
    weightKg: NumberDecimal("1.85"),
    dimensions: { length: 35.5, width: 24.0, height: 1.6, unit: "cm" },
    isActive: true,
    isFeatured: true,
    isDigital: false,
    taxRate: NumberDecimal("8.25"),
    ratingAvg: NumberDecimal("4.8"),
    ratingCount: NumberInt(89),
    tags: ["laptop", "ultrabook", "professional", "4K"],
    attributes: { processor: "Intel Core i9", ram: "32GB", storage: "1TB SSD", display: "15.6 inch 4K OLED" },
    images: [{ url: "https://cdn.example.com/products/laptop-001-1.jpg", alt: "Open laptop" }],
    inventory: { totalStock: NumberInt(45), reservedStock: NumberInt(3), warehouseBreakdown: { MAIN: NumberInt(45) } },
    createdAt: new Date("2024-01-10T14:00:00Z"),
    updatedAt: new Date()
  },
  {
    _id: ObjectId("64a1b2c3d4e5f678cccc0003"),
    sku: "AUDIO-001",
    name: "NoiseCancel Pro Headphones",
    slug: "noisecancel-pro-headphones",
    description: "Premium wireless headphones with active noise cancellation, 40-hour battery life, and Hi-Res audio certification.",
    shortDescription: "Premium ANC wireless headphones",
    categoryId: ObjectId("64a1b2c3d4e5f678aaaa0008"),
    supplierId: ObjectId("64a1b2c3d4e5f678bbbb0001"),
    price: NumberDecimal("349.99"),
    costPrice: NumberDecimal("180.00"),
    compareAtPrice: NumberDecimal("399.99"),
    currency: "USD",
    weightKg: NumberDecimal("0.255"),
    dimensions: { length: 18.0, width: 16.0, height: 8.0, unit: "cm" },
    isActive: true,
    isFeatured: true,
    isDigital: false,
    taxRate: NumberDecimal("8.25"),
    ratingAvg: NumberDecimal("4.7"),
    ratingCount: NumberInt(234),
    tags: ["headphones", "wireless", "ANC", "premium"],
    attributes: { type: "Over-ear", connectivity: "Bluetooth 5.2", batteryLife: "40 hours", driverSize: "40mm" },
    images: [{ url: "https://cdn.example.com/products/audio-001-1.jpg", alt: "Headphones front" }],
    inventory: { totalStock: NumberInt(180), reservedStock: NumberInt(17), warehouseBreakdown: { MAIN: NumberInt(120), EAST: NumberInt(60) } },
    createdAt: new Date("2024-01-12T09:00:00Z"),
    updatedAt: new Date()
  },
  {
    _id: ObjectId("64a1b2c3d4e5f678cccc0004"),
    sku: "GAME-001",
    name: "GameStation 6",
    slug: "gamestation-6",
    description: "Next-generation gaming console with 4K 120fps gaming, 1TB SSD, ray tracing, and backward compatibility.",
    shortDescription: "Next-gen gaming console",
    categoryId: ObjectId("64a1b2c3d4e5f678aaaa0009"),
    supplierId: ObjectId("64a1b2c3d4e5f678bbbb0001"),
    price: NumberDecimal("499.99"),
    costPrice: NumberDecimal("380.00"),
    compareAtPrice: NumberDecimal("549.99"),
    currency: "USD",
    weightKg: NumberDecimal("4.5"),
    dimensions: { length: 39.0, width: 26.0, height: 10.4, unit: "cm" },
    isActive: true,
    isFeatured: true,
    isDigital: false,
    taxRate: NumberDecimal("8.25"),
    ratingAvg: NumberDecimal("4.9"),
    ratingCount: NumberInt(567),
    tags: ["gaming", "console", "4K", "next-gen"],
    attributes: { storage: "1TB SSD", resolution: "4K 120fps", features: ["Ray Tracing", "Backward Compatible"] },
    images: [{ url: "https://cdn.example.com/products/game-001-1.jpg", alt: "Console front" }],
    inventory: { totalStock: NumberInt(80), reservedStock: NumberInt(10), warehouseBreakdown: { MAIN: NumberInt(80) } },
    createdAt: new Date("2024-01-08T11:30:00Z"),
    updatedAt: new Date()
  }
]);

const orderStatuses = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];
const paymentMethods = ['credit_card', 'debit_card', 'paypal', 'bank_transfer'];
const customerIds = [
  ObjectId("64a1b2c3d4e5f6789abcdef0"),
  ObjectId("64a1b2c3d4e5f6789abcdef1"),
  ObjectId("64a1b2c3d4e5f6789abcdef2"),
  ObjectId("64a1b2c3d4e5f6789abcdef3"),
  ObjectId("64a1b2c3d4e5f6789abcdef4")
];
const productData = [
  { id: ObjectId("64a1b2c3d4e5f678cccc0001"), name: "ProMax Smartphone X", sku: "PHONE-001", price: 999.99 },
  { id: ObjectId("64a1b2c3d4e5f678cccc0002"), name: "UltraBook Pro 15", sku: "LAPTOP-001", price: 1899.99 },
  { id: ObjectId("64a1b2c3d4e5f678cccc0003"), name: "NoiseCancel Pro Headphones", sku: "AUDIO-001", price: 349.99 },
  { id: ObjectId("64a1b2c3d4e5f678cccc0004"), name: "GameStation 6", sku: "GAME-001", price: 499.99 }
];

let orders = [];
for (let i = 1; i <= 100; i++) {
  const customerId = customerIds[i % 5];
  const orderDate = new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000);
  const status = orderStatuses[Math.floor(Math.random() * orderStatuses.length)];
  const itemCount = Math.floor(Math.random() * 3) + 1;
  
  let items = [];
  let subtotal = 0;
  for (let j = 0; j < itemCount; j++) {
    const product = productData[Math.floor(Math.random() * productData.length)];
    const qty = Math.floor(Math.random() * 2) + 1;
    const total = product.price * qty;
    subtotal += total;
    items.push({
      productId: product.id,
      productName: product.name,
      productSku: product.sku,
      quantity: NumberInt(qty),
      unitPrice: NumberDecimal(product.price.toString()),
      totalPrice: NumberDecimal(total.toFixed(2))
    });
  }
  
  const taxAmount = subtotal * 0.0825;
  const shippingAmount = Math.random() * 15 + 5;
  const totalAmount = subtotal + taxAmount + shippingAmount;
  
  orders.push({
    orderNumber: "ORD-" + String(i).padStart(6, '0'),
    customerId: customerId,
    status: status,
    paymentMethod: paymentMethods[Math.floor(Math.random() * paymentMethods.length)],
    paymentStatus: Math.random() > 0.2 ? "paid" : "pending",
    items: items,
    subtotal: NumberDecimal(subtotal.toFixed(2)),
    taxAmount: NumberDecimal(taxAmount.toFixed(2)),
    shippingAmount: NumberDecimal(shippingAmount.toFixed(2)),
    discountAmount: NumberDecimal("0.00"),
    totalAmount: NumberDecimal(totalAmount.toFixed(2)),
    currency: "USD",
    shippingAddress: { streetLine1: "123 Delivery St", city: "Anytown", state: "CA", postalCode: "90210", country: "US" },
    createdAt: orderDate,
    updatedAt: new Date()
  });
}
db.orders.insertMany(orders);

db.reviews.insertMany([
  { productId: ObjectId("64a1b2c3d4e5f678cccc0001"), customerId: ObjectId("64a1b2c3d4e5f6789abcdef0"), rating: NumberInt(5), title: "Best phone ever!", content: "Amazing camera quality and battery life.", pros: ["Great camera", "Long battery"], cons: ["Expensive"], isVerifiedPurchase: true, isApproved: true, helpfulCount: NumberInt(45), createdAt: new Date() },
  { productId: ObjectId("64a1b2c3d4e5f678cccc0001"), customerId: ObjectId("64a1b2c3d4e5f6789abcdef3"), rating: NumberInt(4), title: "Great but pricey", content: "Excellent phone with minor drawbacks.", pros: ["Beautiful display", "Smooth UI"], cons: ["Price", "Heavy"], isVerifiedPurchase: true, isApproved: true, helpfulCount: NumberInt(23), createdAt: new Date() },
  { productId: ObjectId("64a1b2c3d4e5f678cccc0002"), customerId: ObjectId("64a1b2c3d4e5f6789abcdef0"), rating: NumberInt(5), title: "Perfect for work", content: "The best laptop I've ever owned.", pros: ["4K display", "Performance"], cons: ["Heavy"], isVerifiedPurchase: true, isApproved: true, helpfulCount: NumberInt(67), createdAt: new Date() },
  { productId: ObjectId("64a1b2c3d4e5f678cccc0003"), customerId: ObjectId("64a1b2c3d4e5f6789abcdef2"), rating: NumberInt(5), title: "Silence is golden", content: "The noise cancellation is incredible.", pros: ["ANC quality", "Comfort"], cons: [], isVerifiedPurchase: true, isApproved: true, helpfulCount: NumberInt(89), createdAt: new Date() },
  { productId: ObjectId("64a1b2c3d4e5f678cccc0004"), customerId: ObjectId("64a1b2c3d4e5f6789abcdef3"), rating: NumberInt(5), title: "Gaming perfection", content: "Load times are insane. Graphics are next level.", pros: ["Fast loading", "Great games"], cons: ["Game prices"], isVerifiedPurchase: true, isApproved: true, helpfulCount: NumberInt(156), createdAt: new Date() }
]);

db.all_bson_types.insertMany([
  {
    description: "All BSON types demonstration",
    stringVal: "Hello MongoDB 你好 🚀",
    emptyString: "",
    int32Val: NumberInt(2147483647),
    int32Min: NumberInt(-2147483648),
    int64Val: NumberLong("9223372036854775807"),
    int64Min: NumberLong("-9223372036854775808"),
    doubleVal: 3.141592653589793,
    doubleNegative: -3.141592653589793,
    doubleInfinity: Infinity,
    doubleNegInfinity: -Infinity,
    decimal128Val: NumberDecimal("12345678901234567890.123456789"),
    decimal128Precise: NumberDecimal("0.1"),
    boolTrue: true,
    boolFalse: false,
    dateVal: new Date("2024-06-15T14:30:45.123Z"),
    dateEpoch: new Date("1970-01-01T00:00:00.000Z"),
    timestampVal: new Timestamp(1705392000, 1),
    objectIdVal: ObjectId(),
    specificObjectId: ObjectId("507f1f77bcf86cd799439011"),
    binaryData: BinData(0, "SGVsbG8gV29ybGQ="),
    uuidBinary: UUID("550e8400-e29b-41d4-a716-446655440000"),
    regexPattern: /^[a-z]+$/i,
    jsCode: Code("function() { return this.name; }"),
    jsCodeWithScope: Code("function(x) { return x + offset; }", { offset: 10 }),
    nullVal: null,
    undefinedVal: undefined,
    minKey: MinKey(),
    maxKey: MaxKey(),
    nestedObject: { level1: { level2: { level3: { deepValue: "nested" } } } },
    arrayOfPrimitives: [1, 2, 3, "four", true, null],
    arrayOfObjects: [{ id: 1, name: "A" }, { id: 2, name: "B" }],
    mixedArray: ["string", NumberInt(42), true, new Date(), ObjectId(), { nested: "object" }],
    emptyArray: [],
    emptyObject: {}
  }
]);

db.null_patterns.insertMany([
  { description: "All nulls except description", allNullRow: null, nullableInt: null, nullableText: null, nullableBool: null, nullableDate: null, nullableObject: null },
  { description: "Only text set", allNullRow: null, nullableInt: null, nullableText: "Some text here", nullableBool: null, nullableDate: null, nullableObject: null },
  { description: "Only int set", allNullRow: null, nullableInt: NumberInt(42), nullableText: null, nullableBool: null, nullableDate: null, nullableObject: null },
  { description: "Only bool set (true)", allNullRow: null, nullableInt: null, nullableText: null, nullableBool: true, nullableDate: null, nullableObject: null },
  { description: "Only bool set (false)", allNullRow: null, nullableInt: null, nullableText: null, nullableBool: false, nullableDate: null, nullableObject: null },
  { description: "Only date set", allNullRow: null, nullableInt: null, nullableText: null, nullableBool: null, nullableDate: new Date("2024-06-15"), nullableObject: null },
  { description: "Only object set", allNullRow: null, nullableInt: null, nullableText: null, nullableBool: null, nullableDate: null, nullableObject: { key: "value" } },
  { description: "All values set", allNullRow: "not null", nullableInt: NumberInt(100), nullableText: "Full row", nullableBool: true, nullableDate: new Date("2024-01-01"), nullableObject: { complete: true } },
  { description: "Empty string vs null", allNullRow: "", nullableInt: NumberInt(0), nullableText: "", nullableBool: null, nullableDate: null, nullableObject: {} }
]);

db.unicode_samples.insertMany([
  { description: "Basic ASCII", sampleText: "Hello, World!", category: "ASCII", charCount: 13 },
  { description: "Emojis", sampleText: "🚀🎉✨💾🔧🎨🌈⚡🔥💡", category: "Emoji", charCount: 10 },
  { description: "Chinese (Simplified)", sampleText: "你好世界！这是中文测试。", category: "CJK", charCount: 12 },
  { description: "Japanese", sampleText: "こんにちは世界！日本語テスト", category: "Japanese", charCount: 14 },
  { description: "Korean", sampleText: "안녕하세요 세계!", category: "Korean", charCount: 9 },
  { description: "Arabic", sampleText: "مرحبا بالعالم!", category: "RTL", charCount: 14 },
  { description: "Russian", sampleText: "Привет мир!", category: "Cyrillic", charCount: 11 },
  { description: "Mixed Scripts", sampleText: "Hello こんにちは 你好 مرحبا 👋", category: "Mixed", charCount: 24 },
  { description: "SQL Injection Attempt", sampleText: "'; DROP TABLE users; --", category: "Security", charCount: 25 }
]);

db.numeric_extremes.insertMany([
  { description: "Maximum 32-bit", int32Val: NumberInt(2147483647), int64Val: NumberLong("9223372036854775807"), doubleVal: 1.7976931348623157e+308, decimalVal: NumberDecimal("99999999999999999999.999999999999") },
  { description: "Minimum negative", int32Val: NumberInt(-2147483648), int64Val: NumberLong("-9223372036854775808"), doubleVal: -1.7976931348623157e+308, decimalVal: NumberDecimal("-99999999999999999999.999999999999") },
  { description: "Zero values", int32Val: NumberInt(0), int64Val: NumberLong("0"), doubleVal: 0, decimalVal: NumberDecimal("0") },
  { description: "Pi approximations", int32Val: NumberInt(3), int64Val: NumberLong("3"), doubleVal: 3.141592653589793, decimalVal: NumberDecimal("3.141592653589793238") }
]);

db.nested_documents.insertOne({
  name: "Complex Organization",
  structure: {
    departments: {
      engineering: {
        teams: {
          backend: {
            members: [
              { name: "Alice", role: "Senior Engineer", skills: ["rust", "mongodb", "docker"], experience: { years: NumberInt(5), previousCompanies: [{ name: "TechCorp", duration: "2 years" }] } }
            ],
            budget: NumberDecimal("250000.00"),
            projects: { active: NumberInt(3), completed: NumberInt(12) }
          }
        },
        totalBudget: NumberDecimal("430000.00")
      }
    },
    metadata: { createdBy: ObjectId("64a1b2c3d4e5f6789abcdef0"), createdAt: new Date(), version: NumberInt(1) }
  }
});

db.array_examples.insertOne({
  name: "Array Type Examples",
  stringArray: ["apple", "banana", "cherry"],
  numberArray: [NumberInt(1), NumberInt(2), NumberInt(3)],
  mixedNumbers: [NumberInt(42), NumberLong("9999999999"), 3.14, NumberDecimal("123.456")],
  booleanArray: [true, false, true],
  dateArray: [new Date(), new Date("2024-01-15T00:00:00.000Z")],
  objectIdArray: [ObjectId(), ObjectId(), ObjectId()],
  emptyArray: [],
  arrayWithNulls: [null, "value", null, NumberInt(42), null],
  objectArray: [{ name: "Item 1", value: NumberInt(10) }, { name: "Item 2", value: NumberInt(20) }],
  nestedArrays: [[NumberInt(1), NumberInt(2)], [NumberInt(3), NumberInt(4)], []],
  largeArray: Array.from({length: 1000}, (_, i) => ({ index: NumberInt(i), value: "item_" + i }))
});

let largeDocs = [];
for (let i = 1; i <= 100000; i++) {
  largeDocs.push({
    randomInt: NumberInt(Math.floor(Math.random() * 1000000)),
    randomText: "Text_" + i + "_" + Math.random().toString(36).substring(7),
    randomDate: new Date(Date.now() - Math.random() * 1000 * 24 * 60 * 60 * 1000),
    randomBool: Math.random() > 0.5,
    category: ["A", "B", "C", "D", "E"][i % 5],
    amount: NumberDecimal((Math.random() * 10000).toFixed(2))
  });
  
  if (largeDocs.length >= 10000) {
    db.large_collection.insertMany(largeDocs);
    largeDocs = [];
  }
}
if (largeDocs.length > 0) {
  db.large_collection.insertMany(largeDocs);
}

db.customers.createIndex({ email: 1 }, { unique: true });
db.customers.createIndex({ lastName: 1, firstName: 1 });
db.customers.createIndex({ createdAt: -1 });
db.customers.createIndex({ "preferences.theme": 1 });

db.products.createIndex({ sku: 1 }, { unique: true });
db.products.createIndex({ categoryId: 1 });
db.products.createIndex({ price: 1 });
db.products.createIndex({ tags: 1 });
db.products.createIndex({ name: "text", description: "text" });

db.orders.createIndex({ customerId: 1 });
db.orders.createIndex({ status: 1 });
db.orders.createIndex({ createdAt: -1 });
db.orders.createIndex({ orderNumber: 1 }, { unique: true });

db.reviews.createIndex({ productId: 1 });
db.reviews.createIndex({ customerId: 1 });
db.reviews.createIndex({ rating: -1 });

db.large_collection.createIndex({ category: 1 });
db.large_collection.createIndex({ randomDate: 1 });
db.large_collection.createIndex({ amount: 1 });

print("MongoDB seed completed successfully!");
print("Collection document counts:");
print("- customers: " + db.customers.countDocuments());
print("- products: " + db.products.countDocuments());
print("- categories: " + db.categories.countDocuments());
print("- orders: " + db.orders.countDocuments());
print("- reviews: " + db.reviews.countDocuments());
print("- all_bson_types: " + db.all_bson_types.countDocuments());
print("- large_collection: " + db.large_collection.countDocuments());
