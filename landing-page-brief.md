# **Query Pilot - Landing Page Content & Design Brief**

## **Brand Identity**

### **Logo**
- **Primary Logo**: `/src/assets/logo.png` (Cat mascot with database stack)
- **Design**: Friendly black cat character holding/hugging a database (3 stacked cylinders)
- **Colors**: Warm orange/amber background (#E9A84D), black cat silhouette
- **Style**: Modern, approachable, tech-friendly
- **Symbolism**: The cat represents agility and intelligence; database represents core functionality

### **Product Name**
**Query Pilot**
*Tagline: "Your Intelligent Database Companion"*

### **Alternative Taglines**
- "Navigate Your Data with Intelligence"
- "Where AI Meets Database Management"
- "The Modern Database IDE You'll Actually Enjoy Using"

---

## **Hero Section**

### **Headline**
```
The Modern Database IDE Built for Developers
```

### **Subheadline**
```
Simple, powerful, and blazing fast.
Query Pilot delivers near-native performance with AI-powered intelligence
— PostgreSQL, MySQL, SQLite free forever.
```

### **Primary CTA**
- **Button**: "Download for Free" (macOS | Windows | Linux)
- **Secondary**: "Watch Demo" or "See Features"
- **Launch Special Badge**: "🎉 Early Bird: Pro Perpetual License $79 (20% off) - 14 days only!"

### **Hero Visual Suggestions**
- Screenshot of main workspace showing split panels with query editor, data grid, and AI assistant
- Animated demo of AI assistant helping write a complex query
- ERD visualization with smooth auto-layout animation

---

## **Core Features (Highlighted Sections)**

### **1. 🤖 AI-Powered Database Assistant**

**Headline**: "Your Personal Database Expert"

**Description**:
Chat with your database using natural language. Query Pilot's AI assistant writes queries, explains results, and optimizes performance — use your own API keys (GPT-5, Claude Sonnet 4.5, Gemini 2.5) or run completely offline with local models.

**Key Points**:
- **Bring Your Own Key (BYOK)**: Connect with your OpenAI, Anthropic, or Google API
- **Local & Private**: Use Ollama CLI for 100% offline AI with no data sharing
- Text-to-SQL generation from natural language
- Query optimization suggestions
- Error fixing with explanations
- Context-aware @mentions for tables and views
- Switch providers/models mid-conversation

**Visual**: Screenshot of AI chat interface with text-to-SQL conversion example

---

### **2. ⚡ Blazing Fast Performance**

**Headline**: "Near-Native Speed That Feels Instant"

**Description**:
Experience desktop-class performance with highly optimized architecture. Query Pilot handles massive datasets with ease — scroll through millions of rows smoothly with intelligent streaming and virtual scrolling.

**Key Points**:
- Near-native performance with minimal overhead
- Infinite scroll through millions of rows without lag
- Intelligent streaming for large result sets
- Optimized query execution and data transfer
- Smart connection pooling for instant queries
- Handles huge datasets that crash other tools

**Visual**: Performance comparison chart or animated data loading demo showing smooth infinite scroll

---

### **3. 🎨 Beautiful, Modern Interface**

**Headline**: "Simple & Intuitive Design"

**Description**:
Clean, modern interface that gets out of your way. Query Pilot features a gorgeous design with light/dark themes, customizable panels, and smooth animations. Everything where you expect it to be.

**Key Points**:
- Split panel workbench for maximum productivity
- High-performance data grid for any dataset size
- Professional SQL editor with syntax highlighting
- Drag-and-drop panel management
- Seamless light/dark theme switching
- Unlimited connections, tabs, and queries
- Zero learning curve — just works

**Visual**: Side-by-side light/dark theme comparison

---

### **4. 🔐 Enterprise-Grade Security**

**Headline**: "Your Data Never Leaves Your Machine"

**Description**:
All connections and queries run locally. Credentials encrypted in OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service). SSH tunnels and AWS SSM bastions for secure remote access.

**Key Points**:
- Encrypted local vault storage
- OS-level keychain integration
- SSH tunnel support (RSA, Ed25519, ECDSA)
- AWS SSM Session Manager integration
- Fully offline capable
- No telemetry, no cloud requirements

**Visual**: Security architecture diagram or encrypted vault icon

---

### **5. 📊 Interactive ER Diagrams**

**Headline**: "Visualize Your Schema Instantly"

**Description**:
Automatic Entity-Relationship diagrams with intelligent auto-layout. Edit DBML code or drag tables visually. Beautiful visualizations that help you understand complex database relationships at a glance.

**Key Points**:
- Automatic diagram generation from your schema
- Dual-mode editing (visual + code)
- Smart relationship detection
- Collapsible tables for large schemas
- Export as images
- Handles complex schemas with ease

**Visual**: Beautiful ERD diagram with highlighted relationships

---

### **6. 🚀 Multi-Database Support**

**Headline**: "From SQLite to Enterprise — One Tool for All"

**Free Tier Databases**:
- ✅ PostgreSQL (Arrays, JSONB, Extensions)
- ✅ MySQL / MariaDB (Full-text search, JSON)
- ✅ SQLite (Lightweight, file-based)

**Pro Tier Adds**:
- ✅ SQL Server (T-SQL support)
- ✅ Oracle (PL/SQL ready)
- ✅ Snowflake (Cloud data warehouse)
- ✅ Amazon Redshift (AWS analytics)
- ✅ ClickHouse (Real-time analytics)
- 🔜 MongoDB, Redis, DuckDB (coming soon)

**Visual**: Database logos arranged in a grid with clear Free vs Pro distinction

---

### **7. 💻 Advanced Query Editor**

**Headline**: "Write SQL Faster"

**Description**:
Professional SQL editor with everything you need — syntax highlighting, autocomplete, multi-cursor editing, and query formatting. Save frequently-used queries, organize with folders, and share with your team.

**Key Points**:
- SQL syntax highlighting & formatting
- Multi-cursor editing for bulk changes
- Keyboard shortcuts (Cmd+Enter to run)
- Query history and favorites
- Unlimited queries and tabs (even in free tier)
- Format and beautify SQL with one click

**Visual**: Code editor with autocomplete dropdown

---

### **8. 🔗 Secure Remote Connections**

**Headline**: "Connect Anywhere, Securely"

**Description**:
SSH tunnels with key-based authentication and SSH agent support. AWS SSM Session Manager for bastion-free access to private VPCs. Reads `~/.ssh/config` automatically. Enterprise-grade security in every tier.

**Key Points**:
- SSH tunnel with key-based authentication
- SSH agent integration for convenience
- AWS SSM bastion support (no exposed ports)
- AWS SSO / OAuth authentication
- Automatic SSH config file reading
- Available in all tiers (even free!)

**Visual**: Connection architecture diagram

---

## **Pricing Tiers** (Updated to Match Strategy)

### **Community Plan** 🎁
**Perfect for Getting Started**

**Price**: $0 Forever

**Includes**:
- ✅ Full core SQL editor with syntax highlighting
- ✅ Beautiful, intuitive UI with light/dark themes
- ✅ **Unlimited connections, tabs, and queries**
- ✅ **PostgreSQL, MySQL, MariaDB, SQLite** support
- ✅ SSH tunnels & AWS SSM (full security features!)
- ✅ Data grid with virtualization
- ✅ Query history
- ✅ Offline use — fully local, no cloud required

**Perfect For**: Students, hobbyists, casual users, small projects

**CTA**: "Download Free"

---

### **Pro Plan** 🚀
**For Professional Developers**

Choose your preferred model:

#### **Option A: Pro Subscription**

**Price**:
- $8/month
- **$80/year** (save ~17% — get 2 months free)

**Everything in Community, plus**:
- ✅ **SQL Server, Oracle** support
- ✅ **Snowflake, Redshift, ClickHouse** support
- ✅ **AI Query Assistant** (text-to-SQL, optimization, error fixing)
- ✅ **Schema Visualizer** (ER diagrams)
- ✅ **Cloud Sync** (connections & queries across devices)
- ✅ **All future updates** while subscribed

**Best For**: Active professionals who want latest features + cloud sync

**CTA**: "Start Free Trial" (14 days)

---

#### **Option B: Pro Perpetual License**

**Price**:
- ~~$99~~ **$79** (Early Bird - 14 days only!)
- **One-time purchase** — own it forever

**Everything in Community, plus**:
- ✅ **SQL Server, Oracle** support
- ✅ **Snowflake, Redshift, ClickHouse** support
- ✅ **AI Query Assistant** (text-to-SQL, optimization, error fixing)
- ✅ **Schema Visualizer** (ER diagrams)
- ✅ **1 year of software updates** included
- ⚠️ **No Cloud Sync** (local-only storage)

**Best For**: Developers who prefer to own software + work offline

**Upgrade Path**: Perpetual holders can add Cloud Sync + updates for **$40/year** (50% off subscription)

**CTA**: "Buy Perpetual License"

---

### **Team Plan** 👥
**For Collaborative Teams**

**Price**:
- $8/user/month
- **$96/user/year** billed annually

**Example**: 5-user team = $480/year total

**Everything in Pro Subscription, plus**:
- ✅ **Shared Connection Library** (team database profiles)
- ✅ **Shared Query Library** (SQL snippets for the team)
- ✅ **Centralized user management**
- ✅ **Consolidated billing**
- ✅ **Team analytics dashboard**

**Minimum**: 3 users

**Best For**: Development agencies, startups, corporate teams

**CTA**: "Contact Sales" or "Start Team Trial"

---

## **Pricing Comparison Table**

| Feature | Community | Pro Subscription | Pro Perpetual | Team |
|---------|-----------|------------------|---------------|------|
| **Price** | **Free** | **$8/mo** or **$80/yr** | **~~$99~~ $79** one-time | **$96/user/yr** |
| **PostgreSQL, MySQL, SQLite** | ✅ | ✅ | ✅ | ✅ |
| **SQL Server, Oracle** | ❌ | ✅ | ✅ | ✅ |
| **Snowflake, Redshift, ClickHouse** | ❌ | ✅ | ✅ | ✅ |
| **Unlimited Connections/Tabs** | ✅ | ✅ | ✅ | ✅ |
| **SSH Tunnels & AWS SSM** | ✅ | ✅ | ✅ | ✅ |
| **AI Query Assistant** | ❌ | ✅ | ✅ | ✅ |
| **Schema Visualizer (ERD)** | ❌ | ✅ | ✅ | ✅ |
| **Cloud Sync** | ❌ | ✅ | ❌ | ✅ |
| **Software Updates** | ✅ Current | ✅ Continuous | ✅ 1 year | ✅ Continuous |
| **Shared Libraries** | ❌ | ❌ | ❌ | ✅ |
| **Team Management** | ❌ | ❌ | ❌ | ✅ |
| **Support** | Community | Email | Email | Email |

---

## **Launch Special Section** 🎉

**Headline**: "Early Bird Special - Limited Time Only!"

```
🚀 Launch Celebration

Get the Pro Perpetual License for just $79
(20% off the regular $99 price)

⏰ Offer ends in: [COUNTDOWN TIMER - 14 days]

Own Query Pilot forever + 1 year of updates
No recurring fees • Offline-first • BYOK AI or local models

[Claim Early Bird Deal →]
```

**Visual**: Prominent badge or banner with countdown timer

---

## **Perpetual License Upgrade Path**

**Callout Box** (on pricing page):

```
📦 Already own a Perpetual License?

Upgrade to full Pro Subscription for just $40/year (50% off!)

✅ Get Cloud Sync across all your devices
✅ Continuous software updates forever

Available after your initial 1-year update period,
or activate immediately if you need Cloud Sync now.

[Learn More About Upgrade →]
```

---

## **FAQ Section** (Updated)

**Q: What's the difference between Community and Pro?**
A: Community is perfect for common databases (PostgreSQL, MySQL, SQLite) with unlimited connections. Pro adds enterprise databases (SQL Server, Oracle, Snowflake, Redshift, ClickHouse), AI assistant, and ER diagrams.

**Q: Should I buy Perpetual or Subscription?**
A:
- **Perpetual ($79 early bird)**: Own it forever, work offline, 1 year updates. Perfect if you don't need cloud sync.
- **Subscription ($80/year)**: Cloud sync + continuous updates. Best for multi-device workflows.

**Q: Can I upgrade from Perpetual to Subscription later?**
A: Yes! Perpetual license holders get 50% off subscription ($40/year instead of $80) to add Cloud Sync and continuous updates.

**Q: Is the AI assistant included in free tier?**
A: No, AI features require Pro. However, you can use the full SQL editor, unlimited connections, and all core features for free forever.

**Q: What's included in the "1 year of updates" for Perpetual?**
A: All bug fixes, performance improvements, and new features released within 1 year of purchase. After that, your version keeps working forever — you just won't get new features unless you upgrade.

**Q: Do I need internet for Query Pilot to work?**
A: No! Community and Perpetual licenses are fully offline. Only Cloud Sync (Pro Subscription/Team) requires internet.

**Q: Which databases work in the free tier?**
A: PostgreSQL, MySQL, MariaDB, and SQLite are fully supported and always free. Enterprise databases require Pro.

**Q: What payment methods do you accept?**
A: We use Lemon Squeezy for all transactions. Credit cards, PayPal, and various local payment methods supported.

**Q: Can I get a refund?**
A: Yes! 14-day money-back guarantee on all paid plans, no questions asked.

**Q: Is there a student discount?**
A: The Community plan is free forever and includes all core features — perfect for students! Pro discounts may be available; contact us.

---

## **Target Audience**

### **Primary Personas**

1. **Full-Stack Developers**
   - Need quick database access during development
   - PostgreSQL/MySQL for most projects (Community tier perfect)
   - Occasionally work with enterprise DBs (upgrade to Pro)

2. **Data Analysts**
   - Run ad-hoc queries daily
   - Need fast data exports
   - Appreciate beautiful ER diagrams (Pro feature)

3. **Independent Consultants**
   - Prefer one-time purchases (Perpetual license ideal)
   - Work offline frequently
   - Multiple client databases

4. **Development Teams**
   - Shared query libraries save time
   - Centralized connection management
   - Team plan scales with headcount

---

## **Social Proof Section**

**Headline**: "Loved by Developers Worldwide"

### **Launch Goals** (to showcase after launch)
- 🎯 "1,000+ downloads in first week"
- ⚡ "30% faster than TablePlus on large queries"
- 🌍 "Early adopters from 25+ countries"
- 💬 "4.8/5 Product Hunt rating"

### **Testimonial Placeholders**
```
"The Perpetual license was a no-brainer — $79 to own it forever?
Sold. And the AI assistant is surprisingly good."
— Alex Chen, Indie Developer
```

```
"We moved our whole team from TablePlus. The shared query library
alone pays for itself in saved time."
— Maria Rodriguez, CTO @ StartupCo
```

```
"Finally, a database tool that doesn't force me into a subscription.
Perpetual + $40/year upgrade is perfect."
— James Wilson, Freelance Consultant
```

---

## **Call-to-Action Sections**

### **Primary CTA** (Footer)
```
Ready to Transform Your Database Workflow?

Download Query Pilot today — Free forever for PostgreSQL, MySQL & SQLite.
Upgrade anytime for enterprise databases + AI features.

[Download for macOS] [Download for Windows] [Download for Linux]

🎉 Early Bird: Pro Perpetual just $79 for 14 days!
```

### **Secondary CTAs**
- "Start Free Trial" (Pro Subscription - 14 days)
- "See Full Pricing"
- "Watch Demo Video"
- "Read Documentation"
- "Join Discord Community"

---

## **Launch Platform Strategy**

### **Pre-Launch Checklist**
- [ ] Website live at `querypilot.dev`
- [ ] Pricing page with Early Bird countdown
- [ ] Lemon Squeezy integration tested
- [ ] Demo video (2-3 min) ready
- [ ] Screenshots polished (light + dark)
- [ ] Documentation complete
- [ ] Product Hunt launch scheduled

### **Launch Week Tactics**
1. **Product Hunt**: Launch Tuesday/Wednesday for max visibility
2. **Hacker News**: "Show HN: Query Pilot - Native database IDE with AI assistant"
3. **Reddit**: r/databases, r/SQL, r/devtools, r/indiehackers
4. **Twitter/X**: Thread highlighting Early Bird special
5. **Dev.to**: Launch blog post with technical deep dive

---

## **Design System Recommendations**

### **Color Palette** (Based on Logo)
- **Primary**: Warm amber/gold (#E9A84D) - from logo background
- **Accent**: Deep charcoal (#2D2D2D) - from cat silhouette
- **Success**: Emerald green (#10B981)
- **Warning**: Sunset orange (#F97316)
- **Info**: Sky blue (#3B82F6)

### **Typography**
- **Headings**: Inter or Geist Sans (modern, clean)
- **Body**: System font stack (native feel)
- **Code**: JetBrains Mono or Fira Code

### **Visual Style**
- Modern, minimal interface
- Generous whitespace
- Subtle shadows and gradients
- Smooth animations (framer-motion)
- Dark mode first, light mode optimized

---

## **Additional Assets Needed**

1. **Screenshots**
   - Main workspace view
   - AI assistant chat interface
   - ERD diagram example
   - Data grid with large dataset
   - Connection dialog
   - Light & dark theme comparison

2. **Demo Videos**
   - 30-second hero animation
   - AI assistant in action (2 min)
   - Complete workflow walkthrough (5 min)

3. **Icons**
   - Feature icons (AI, security, speed, etc.)
   - Database logos (already in `/public/logos/`)
   - Platform badges (macOS, Windows, Linux)

4. **Marketing Graphics**
   - Social media banners (Twitter, LinkedIn)
   - Open Graph images
   - App Store screenshots (if applicable)

---

## **Technical Specifications**

**Product Identifier**: `dev.querypilot.studio`
**Version**: 0.2.0
**License**: Proprietary
**Platforms**: macOS 10.15+, Windows 10+, Linux (x64)
**Bundle Size**: ~15MB
**Payment Processor**: Lemon Squeezy
**Website**: querypilot.dev

---

**This comprehensive brief aligns perfectly with your product-led growth strategy, perpetual license option, and Early Bird launch promotion!**
