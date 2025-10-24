import React, { useState, useEffect, useRef, FormEvent } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI, Type, FunctionDeclaration, Chat } from '@google/genai';

// --- ASSETS ---
const logoBase64 = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSIjZmRmYWY2IiBzdHJva2U9IiNmZGZhZjYiIHN0cm9rZS13aWR0aD0iMCIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNMjAsOUg0VjVoMTZWOU0xOCwxMXY3aDJ2Mkg0di0yaDJ2LTdINFY1YzAtMS4xMS45LTIsMi0yaDEyYzEuMSwwLDIsLjksMiwyVjExTTgsMTF2N2g4di03SDhaIi8+PC9zdmc+";

// --- TYPES AND INTERFACES ---
interface OrderItem {
  id: string;
  name: string;
  clientName: string;
  type: 'new' | 'old';
  status: 'progress' | 'finished' | 'delivery';
  totalCost: number;
  paidAmount: number;
  createdAt: number;
  deliveryDate?: number;
  laborCost?: number;
}

interface InventoryItem {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  price: number;
}

interface ExpenseItem {
    id: string;
    description: string;
    amount: number;
    date: number;
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'loading' | 'tool-call';
  text: string;
}

interface PricedMaterial {
    id: string;
    name: string;
    unit: string;
    price: number;
}

interface CalculationListItem {
    materialId: string;
    materialName: string;
    quantity: number;
    unit: string;
    price: number;
    total: number;
}

interface CalculationList {
    id: string;
    name: string;
    items: CalculationListItem[];
    totalCost: number;
    createdAt: number;
}

interface NotepadEntry {
    id: string;
    clientName: string;
    amount: number;
}


interface AppData {
    orders: OrderItem[];
    inventory: InventoryItem[];
    expenses: ExpenseItem[];
    pricedMaterials: PricedMaterial[];
    savedCalculations: CalculationList[];
    notepad: NotepadEntry[];
    chatHistory: Message[];
    lastBackupDate: number | null;
    notificationPermission: NotificationPermission;
}

interface OrderCardProps {
  order: OrderItem;
  onOpenModal: (type: string, data: any) => void;
}

interface CalculatorTabProps {
    appData: AppData;
    setAppData: React.Dispatch<React.SetStateAction<AppData>>;
    handleOpenModal: (type: string, data?: any) => void;
    setNotification: React.Dispatch<React.SetStateAction<string | null>>;
}


type Tab = 'dashboard' | 'orders' | 'warehouse' | 'expenses' | 'schedule' | 'calculator' | 'notepad';
type SortByType = 'newest' | 'oldest' | 'name';
type Theme = 'light' | 'dark';

const API_KEY = process.env.API_KEY;

// --- AI CONFIGURATION (TOOLS & SYSTEM INSTRUCTION) ---
const tools: FunctionDeclaration[] = [
    {
      name: 'registerOrder',
      description: 'يسجل طلب شغل جديد أو قديم في الورشة.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING, description: 'وصف الطلب، مثال: "سرير 160" أو "تنجيد كنبة".' },
          clientName: { type: Type.STRING, description: 'اسم العميل.' },
          type: { type: Type.STRING, enum: ['new', 'old'], description: 'نوع الشغل، "new" للشغل الجديد، "old" للصيانة أو المتابعات.' },
          totalCost: { type: Type.NUMBER, description: 'التكلفة الإجمالية للطلب.' },
          paidAmount: { type: Type.NUMBER, description: 'المبلغ المدفوع مقدمًا عند تسجيل الطلب.' },
          laborCost: { type: Type.NUMBER, description: 'قيمة المصنعية أو المكسب من الطلب.' }
        },
        required: ['name', 'clientName', 'type', 'totalCost']
      }
    },
    {
        name: 'recordPayment',
        description: 'يسجل دفعة دفعها العميل لطلب معين.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                orderName: { type: Type.STRING, description: 'اسم الطلب اللي العميل دفع له.' },
                amount: { type: Type.NUMBER, description: 'المبلغ اللي اندفع.' }
            },
            required: ['orderName', 'amount']
        }
    },
    {
        name: 'updateOrderStatus',
        description: 'يحدّث حالة طلب معين (شغال، خلص، مستني تسليم).',
        parameters: {
            type: Type.OBJECT,
            properties: {
                orderName: { type: Type.STRING, description: 'اسم الطلب المطلوب تحديث حالته.' },
                status: { type: Type.STRING, enum: ['progress', 'finished', 'delivery'], description: 'الحالة الجديدة للطلب.' }
            },
            required: ['orderName', 'status']
        }
    },
     {
        name: 'calculateDetailedCost',
        description: 'يحسب التكلفة الإجمالية بناءً على الخامات المستخدمة وأسعارها المسجلة في الحاسبة.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                items: {
                    type: Type.OBJECT,
                    description: 'قاموس يحتوي على أسماء الخامات والكمية المطلوبة. مثال: {"قماش": 5, "خشب": 2}',
                    properties: {}
                }
            },
            required: ['items']
        }
    },
    {
        name: 'deleteOrder',
        description: 'يمسح أو يحذف طلب معين من القائمة.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                orderName: { type: Type.STRING, description: 'اسم الطلب اللي هيتمسح.' }
            },
            required: ['orderName']
        }
    },
    {
        name: 'getDashboardSummary',
        description: 'يعرض ملخصًا للشغل الحالي: عدد الطلبات الشغالة، إجمالي المديونيات، والدخل وصافي الربح الشهري من المصنعية.',
        parameters: { type: Type.OBJECT, properties: {} }
    },
    {
        name: 'getOrderDetails',
        description: 'يعرض تفاصيل حساب أو طلب معين، زي التكلفة الإجمالية والمدفوع والباقي.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                orderName: { type: Type.STRING, description: 'اسم الطلب أو اسم العميل المطلوب عرض حسابه.' }
            },
            required: ['orderName']
        }
    },
    {
        name: 'addExpense',
        description: 'يسجل مصروفات عامة للورشة زي الإيجار أو الكهرباء.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                description: { type: Type.STRING, description: 'وصف المصروف، مثال: "فاتورة كهرباء" أو "إيجار الورشة".' },
                amount: { type: Type.NUMBER, description: 'قيمة المصروف بالجنيه.' }
            },
            required: ['description', 'amount']
        }
    },
    {
        name: 'setDeliveryDate',
        description: 'يسجل أو يحدد موعد تسليم لطلب معين.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                orderName: { type: Type.STRING, description: 'اسم الطلب المراد تحديد موعد تسليمه.' },
                deliveryDate: { type: Type.STRING, description: 'تاريخ التسليم بصيغة YYYY-MM-DD. يجب عليك تحويل التواريخ العامية مثل "بكرة" أو "الخميس الجاي" إلى هذه الصيغة قبل استدعاء الأداة.' },
            },
            required: ['orderName', 'deliveryDate']
        }
    },
    {
        name: 'addNotepadEntry',
        description: 'يسجل حساب جديد لعميل في النوتة بالمبلغ اللي عليه.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                clientName: { type: Type.STRING, description: 'اسم العميل.' },
                amount: { type: Type.NUMBER, description: 'المبلغ اللي على العميل.' }
            },
            required: ['clientName', 'amount']
        }
    },
    {
        name: 'updateNotepadEntry',
        description: 'يعدل حساب عميل موجود في النوتة، سواء بالزيادة أو النقصان (لو دفع جزء).',
        parameters: {
            type: Type.OBJECT,
            properties: {
                clientName: { type: Type.STRING, description: 'اسم العميل اللي حسابه هيتعدل.' },
                amountChange: { type: Type.NUMBER, description: 'المبلغ اللي هيتغير. استخدم قيمة موجبة للزيادة وقيمة سالبة للنقصان (للدفع).' }
            },
            required: ['clientName', 'amountChange']
        }
    }
  ];
  
const systemInstruction = `أنت "مساعد الورشة الذكي"، خبير إدارة ورش التنجيد والنجارة. تتكلم بلهجة مصرية أصيلة زي الصنايعية الشاطرين، أسلوبك ودود وإيجابي ودايمًا جاهز للمساعدة. هدفك تسهيل الشغل على المستخدم ومساعدته في كل حاجة من حسابات ومتابعة شغل وتسجيل مصاريف.

**قواعدك الأساسية:**

1.  **خليك إيجابي وخدوم:** ابدأ ردودك بعبارات زي "تحت أمرك يا أسطى"، "كله هيخلص على أكمل وجه"، "عينيّا ليك". خليك متفائل وشجع المستخدم.
2.  **التأكيد باسم العميل/الطلب:** دي أهم حاجة. لما تعمل أي حاجة ليها علاقة بطلب معين (تسجل دفعة، تغير حالة، تحدد معاد تسليم)، لازم تذكر اسم الطلب أو اسم العميل في ردك عشان المستخدم يبقى متأكد إنك عملت الحاجة الصح.
    *   **مثال غلط:** "تم تسجيل الدفعة."
    *   **مثال صح:** "تمام يا معلم، سجلت دفعة لطلب 'كنبة أستاذ محمد' والمبلغ المتبقي بقى X جنيه."
3.  **الدقة أهم شيء:** لو مش متأكد من اسم الطلب اللي المستخدم قصده، اسأله عشان توضح. قول مثلاً: "تقصد أنهي طلب يا أسطى؟ اللي باسم أستاذ علي ولا أستاذ كريم؟"
4.  **استخدم الأدوات بتاعتك صح:**
    *   **حساب التكاليف:** استخدم \`calculateDetailedCost\` وقول للمستخدم لو في خامة ناقصة عشان يسجلها.
    *   **تسجيل الطلبات:** استخدم \`registerOrder\` ومتنساش تسأل عن كل التفاصيل بما فيها "المصنعية" لو المستخدم مدخلهاش.
    *   **مواعيد التسليم:** استخدم \`setDeliveryDate\` وحوّل أي تاريخ عامي (زي بكرة أو الخميس الجاي) لصيغة YYYY-MM-DD.
    *   **المصاريف والنوتة:** استخدم أدوات \`addExpense\`, \`addNotepadEntry\`, \`updateNotepadEntry\` لتسجيل أي حاجة بره الطلبات.
    *   **التقارير:** لخص حالة الشغل موضحًا إجمالي الدخل والمصاريف وصافي الربح من المصنعية هذا الشهر لما تتطلب منك باستخدام \`getDashboardSummary\`.
5.  **ركز على النتيجة:** متقولش تفاصيل فنية عن الأدوات اللي بتستخدمها. قول للمستخدم النتيجة النهائية بشكل واضح ومباشر. "حسبتها لك يا باشا، التكلفة الإجمالية هتبقى X جنيه."`;


// --- DATA MIGRATION & HELPERS ---
const getInitialState = (): AppData => ({
    orders: [],
    inventory: [],
    expenses: [],
    pricedMaterials: [],
    savedCalculations: [],
    notepad: [],
    chatHistory: [],
    lastBackupDate: null,
    notificationPermission: 'default'
});

const migrateAndLoadData = (rawDataToImport?: any): AppData => {
    const initialState = getInitialState();
    let rawData: any;

    if (rawDataToImport) {
        rawData = rawDataToImport;
    } else {
        try {
            const item = localStorage.getItem('workshopData');
            rawData = item ? JSON.parse(item) : {};
        } catch (error) {
            console.error("Error loading data from localStorage, starting fresh.", error);
            rawData = {};
        }
    }

    const cleanData: AppData = { ...initialState };

    cleanData.orders = (Array.isArray(rawData.orders) ? rawData.orders : [])
        .filter((item: any) => item && typeof item === 'object' && item.id && item.name)
        .map((order: any): OrderItem => ({
            id: order.id,
            name: order.name || 'طلب غير مسمى',
            clientName: order.clientName || 'غير مسجل',
            type: ['new', 'old'].includes(order.type) ? order.type : 'new',
            status: ['progress', 'finished', 'delivery'].includes(order.status) ? order.status : 'progress',
            totalCost: Number(order.totalCost) || 0,
            paidAmount: Number(order.paidAmount) || 0,
            createdAt: order.createdAt || Date.now(),
            deliveryDate: order.deliveryDate || undefined,
            laborCost: Number(order.laborCost) || undefined,
        }));
    
    cleanData.inventory = (Array.isArray(rawData.inventory) ? rawData.inventory : [])
        .filter((item: any) => item && typeof item === 'object' && item.id && item.name)
        .map((item: any): InventoryItem => ({
            id: item.id,
            name: item.name,
            quantity: Number(item.quantity) || 0,
            unit: item.unit || 'قطعة',
            price: Number(item.price) || 0,
        }));

    cleanData.expenses = (Array.isArray(rawData.expenses) ? rawData.expenses : [])
        .filter((item: any) => item && typeof item === 'object' && item.id && item.description)
        .map((item: any): ExpenseItem => ({
            id: item.id,
            description: item.description,
            amount: Number(item.amount) || 0,
            date: item.date || Date.now(),
        }));
    
    cleanData.pricedMaterials = (Array.isArray(rawData.pricedMaterials) ? rawData.pricedMaterials : [])
        .filter((item: any) => item && typeof item === 'object' && item.id && item.name)
        .map((item: any): PricedMaterial => ({
            id: item.id,
            name: item.name,
            unit: item.unit || 'قطعة',
            price: Number(item.price) || 0,
        }));

    cleanData.savedCalculations = (Array.isArray(rawData.savedCalculations) ? rawData.savedCalculations : [])
        .filter((item: any) => item && typeof item === 'object' && item.id && item.name && Array.isArray(item.items))
        .map((item: any): CalculationList => ({
            id: item.id,
            name: item.name,
            items: Array.isArray(item.items) ? item.items.filter(Boolean) : [],
            totalCost: Number(item.totalCost) || 0,
            createdAt: item.createdAt || Date.now(),
        }));
        
    cleanData.notepad = (Array.isArray(rawData.notepad) ? rawData.notepad : [])
        .filter((item: any) => item && typeof item === 'object' && item.id && item.clientName)
        .map((item: any): NotepadEntry => ({
            id: item.id,
            clientName: item.clientName,
            amount: Number(item.amount) || 0,
        }));

    cleanData.lastBackupDate = rawData.lastBackupDate || null;
    cleanData.notificationPermission = ['default', 'granted', 'denied'].includes(rawData.notificationPermission) ? rawData.notificationPermission : 'default';
    cleanData.chatHistory = (Array.isArray(rawData.chatHistory) ? rawData.chatHistory : []).filter(Boolean);

    return cleanData;
};


// --- UI COMPONENTS ---
const OrderCard: React.FC<OrderCardProps> = ({ order, onOpenModal }) => {
    const remaining = order.totalCost - order.paidAmount;
    const statusMap = {
        progress: { text: 'شغال', className: 'status-progress' },
        finished: { text: 'خلص', className: 'status-finished' },
        delivery: { text: 'مستني تسليم', className: 'status-delivery' },
    };
    const { text, className } = statusMap[order.status];
    const formattedDate = new Date(order.createdAt).toLocaleDateString('ar-EG');

    return (
        <div className="order-card">
            <h3>{order.name} <span className={`status ${className}`}>{text}</span></h3>
            <div className="order-details">
                <p><strong>العميل:</strong> {order.clientName}</p>
                <p><strong>التكلفة:</strong> {order.totalCost.toLocaleString()} جنيه</p>
                <p><strong>المدفوع:</strong> {order.paidAmount.toLocaleString()} جنيه</p>
                <p><strong>الباقي:</strong> {remaining.toLocaleString()} جنيه</p>
                 {order.laborCost && (
                    <p className="labor-cost-info">
                        <strong>المصنعية:</strong> 
                        {order.laborCost.toLocaleString()} جنيه
                    </p>
                )}
                 {order.deliveryDate && (
                    <p className="delivery-date-info">
                        <strong>معاد التسليم:</strong> 
                        {new Date(order.deliveryDate).toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' })}
                    </p>
                )}
            </div>
             <div className="order-card-footer">
                <p>تاريخ التسجيل: {formattedDate}</p>
            </div>
            <div className="order-actions">
                <button onClick={() => onOpenModal('record-payment', order)} className="action-btn payment-btn">تسجيل دفعة</button>
                <button onClick={() => onOpenModal('update-status', order)} className="action-btn status-btn">تحديث الحالة</button>
                <button onClick={() => onOpenModal('set-delivery-date', order)} className="action-btn date-btn">تحديد معاد</button>
                <button onClick={() => onOpenModal('delete-order', order)} className="action-btn delete-btn">حذف</button>
            </div>
        </div>
    );
};

const ScheduleCard: React.FC<{ order: OrderItem }> = ({ order }) => {
    if (!order.deliveryDate) return null;

    const deliveryDate = new Date(order.deliveryDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize today's date
    const normalizedDeliveryDate = new Date(deliveryDate.getTime());
    normalizedDeliveryDate.setHours(0, 0, 0, 0); // Normalize delivery date

    const diffTime = normalizedDeliveryDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    let remainingText = '';
    if (diffDays < 0) {
        remainingText = `متأخر ${Math.abs(diffDays)} أيام`;
    } else if (diffDays === 0) {
        remainingText = 'التسليم النهاردة';
    } else if (diffDays === 1) {
        remainingText = 'التسليم بكرة';
    } else {
        remainingText = `باقي ${diffDays} أيام`;
    }
    
    const cardClass = diffDays < 0 ? 'late' : diffDays <= 3 ? 'soon' : 'normal';

    return (
        <div className={`schedule-card ${cardClass}`}>
            <div className="schedule-card-date">
                <span className="day">{deliveryDate.getDate()}</span>
                <span className="month">{deliveryDate.toLocaleDateString('ar-EG', { month: 'short' })}</span>
            </div>
            <div className="schedule-card-info">
                <h4>{order.name}</h4>
                <p>العميل: {order.clientName}</p>
            </div>
            <div className="schedule-card-remaining">
                <p>{remainingText}</p>
            </div>
        </div>
    );
};

const ChatInput: React.FC<{ onUserInput: (text: string) => void; isLoading: boolean; }> = ({ onUserInput, isLoading }) => {
    const [input, setInput] = useState('');
    const [isListening, setIsListening] = useState(false);
    const recognitionRef = useRef<any | null>(null);

    // Check for browser support and type safety
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    const handleMicClick = () => {
        if (!SpeechRecognition) {
            alert('المتصفح بتاعك مش بيدعم الإدخال الصوتي.');
            return;
        }

        if (isListening) {
            recognitionRef.current?.stop();
            setIsListening(false);
            return;
        }

        const recognition = new SpeechRecognition();
        recognitionRef.current = recognition;
        recognition.lang = 'ar-EG';
        recognition.continuous = false;
        recognition.interimResults = true;

        recognition.onstart = () => {
            setIsListening(true);
        };

        recognition.onresult = (event: any) => {
            const transcript = Array.from(event.results)
                .map((result: any) => result[0])
                .map((result: any) => result.transcript)
                .join('');
            setInput(transcript);
        };

        recognition.onerror = (event: any) => {
            console.error('Speech recognition error:', event.error);
            setIsListening(false);
        };

        recognition.onend = () => {
            setIsListening(false);
        };
        
        recognition.start();
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (input.trim()) {
            onUserInput(input);
            setInput('');
        }
    };

    return (
        <form onSubmit={handleSubmit} className="chat-input-form" aria-label="إرسال رسالة">
             <button type="submit" disabled={isLoading || !input.trim()}>{isLoading ? '...' : 'ابعت'}</button>
            <input 
                type="text" 
                value={input} 
                onChange={e => setInput(e.target.value)} 
                placeholder={isListening ? "جاري الاستماع..." : "اكتب أو دوس على الميكروفون..."} 
                disabled={isLoading} 
                aria-label="اكتب رسالتك"
            />
            {SpeechRecognition && (
                 <button type="button" onClick={handleMicClick} className={`mic-btn ${isListening ? 'listening' : ''}`} disabled={isLoading}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line></svg>
                </button>
            )}
        </form>
    );
};

const Notification: React.FC<{ message: string }> = ({ message }) => {
    if (!message) return null;
    return <div className="notification-toast" role="alert" aria-live="assertive">{message}</div>;
};

const Modal: React.FC<{ config: { type: string; data?: any; title: string }; onClose: () => void; onSubmit: (formData: any) => void; }> = ({ config, onClose, onSubmit }) => {
    const { type, data, title } = config;

    const handleSubmit = (e: FormEvent) => {
        e.preventDefault();
        const formData = new FormData(e.target as HTMLFormElement);
        const values: Record<string, any> = {};
        formData.forEach((value, key) => { values[key] = value; });
        onSubmit({ ...data, ...values });
    };

    const renderForm = () => {
        switch (type) {
             case 'add-order':
                return <>
                    <div className="form-group"><label htmlFor="name">وصف الطلب</label><input type="text" id="name" name="name" required autoFocus /></div>
                    <div className="form-group"><label htmlFor="clientName">اسم العميل</label><input type="text" id="clientName" name="clientName" required /></div>
                    <div className="form-group"><label htmlFor="totalCost">التكلفة الإجمالية</label><input type="number" id="totalCost" name="totalCost" required /></div>
                    <div className="form-group"><label htmlFor="paidAmount">المبلغ المدفوع (مقدم)</label><input type="number" id="paidAmount" name="paidAmount" placeholder="0" /></div>
                    <div className="form-group"><label htmlFor="laborCost">المصنعية (المكسب)</label><input type="number" id="laborCost" name="laborCost" placeholder="0" /></div>
                    <div className="form-group">
                        <label>نوع الشغل</label>
                        <div className="radio-group">
                            <label><input type="radio" name="type" value="new" defaultChecked={!data?.type || data.type === 'new'} /> شغل جديد</label>
                            <label><input type="radio" name="type" value="old" defaultChecked={data?.type === 'old'} /> شغل صيانة</label>
                        </div>
                    </div>
                </>;
            case 'record-payment':
                return <>
                    <div className="form-group">
                        <label htmlFor="amount">المبلغ المدفوع</label>
                        <input type="number" id="amount" name="amount" required autoFocus />
                    </div>
                </>;
            case 'update-status':
                return <>
                    <div className="form-group">
                        <label htmlFor="status">الحالة الجديدة</label>
                        <select id="status" name="status" defaultValue={data.status} required>
                            <option value="progress">شغال</option>
                            <option value="finished">خلص</option>
                            <option value="delivery">مستني تسليم</option>
                        </select>
                    </div>
                </>;
            case 'set-delivery-date': {
                const timestampToYYYYMMDD = (ts?: number) => {
                    if (!ts) return '';
                    const date = new Date(ts);
                    const year = date.getFullYear();
                    const month = (date.getMonth() + 1).toString().padStart(2, '0');
                    const day = date.getDate().toString().padStart(2, '0');
                    return `${year}-${month}-${day}`;
                };
                const today = new Date();
                const todayString = `${today.getFullYear()}-${(today.getMonth() + 1).toString().padStart(2, '0')}-${today.getDate().toString().padStart(2, '0')}`;

                return <>
                    <div className="form-group">
                        <label htmlFor="deliveryDate">تاريخ التسليم</label>
                        <input type="date" id="deliveryDate" name="deliveryDate" defaultValue={timestampToYYYYMMDD(data.deliveryDate)} required autoFocus min={todayString} />
                    </div>
                </>;
            }
             case 'add-inventory':
                return <>
                    <div className="form-group"><label htmlFor="name">اسم الخامة</label><input type="text" id="name" name="name" required /></div>
                    <div className="form-group"><label htmlFor="quantity">الكمية</label><input type="number" id="quantity" name="quantity" required /></div>
                    <div className="form-group"><label htmlFor="unit">وحدة القياس</label><input type="text" id="unit" name="unit" placeholder="متر، كيلو، قطعة..." required /></div>
                    <div className="form-group"><label htmlFor="price">سعر الوحدة (بالجنيه)</label><input type="number" id="price" name="price" step="0.01" required /></div>
                </>;
             case 'update-inventory':
                 return <>
                    <div className="form-group"><label htmlFor="quantity">الكمية الجديدة</label><input type="number" id="quantity" name="quantity" defaultValue={data.quantity} required /></div>
                    <div className="form-group"><label htmlFor="price">السعر الجديد للحدة</label><input type="number" id="price" name="price" defaultValue={data.price} step="0.01" required /></div>
                </>;
            case 'add-expense':
                 return <>
                    <div className="form-group"><label htmlFor="description">وصف المصروف</label><input type="text" id="description" name="description" required /></div>
                    <div className="form-group"><label htmlFor="amount">المبلغ</label><input type="number" id="amount" name="amount" required /></div>
                </>;
             case 'add-priced-material':
                return <>
                    <div className="form-group"><label htmlFor="name">اسم الخامة</label><input type="text" id="name" name="name" required /></div>
                    <div className="form-group"><label htmlFor="unit">وحدة القياس</label><input type="text" id="unit" name="unit" placeholder="متر، لوح، كيلو..." required /></div>
                    <div className="form-group"><label htmlFor="price">سعر الوحدة</label><input type="number" id="price" name="price" step="0.01" required /></div>
                </>;
            case 'edit-priced-material':
                return <>
                    <div className="form-group"><label htmlFor="price">السعر الجديد للحدة</label><input type="number" id="price" name="price" defaultValue={data.price} step="0.01" required /></div>
                </>;
            case 'add-notepad-entry':
                return <>
                    <div className="form-group"><label htmlFor="clientName">اسم العميل</label><input type="text" id="clientName" name="clientName" required /></div>
                    <div className="form-group"><label htmlFor="amount">المبلغ اللي عليه</label><input type="number" id="amount" name="amount" required /></div>
                </>;
            case 'edit-notepad-entry':
                return <>
                    <div className="form-group"><label htmlFor="amount">المبلغ الجديد</label><input type="number" id="amount" name="amount" defaultValue={data.amount} required /></div>
                </>;
            case 'clear-finished-orders':
                return <p>هل أنت متأكد أنك تريد مسح كل الطلبات التي حالتها "خلص"؟ لا يمكن التراجع عن هذا الإجراء.</p>;
            case 'clear-all-data':
                 return <p><strong>تحذير خطير!</strong> هل أنت متأكد تمامًا من أنك تريد مسح كل بيانات التطبيق؟ سيتم حذف جميع الطلبات والمخزن والمصاريف وكل شيء. <strong>لا يمكن التراجع عن هذا الإجراء نهائيًا.</strong></p>;
            case 'confirm-import':
                return <p><strong>تحذير:</strong> هل أنت متأكد أنك تريد استيراد هذه البيانات؟ سيتم استبدال كل بياناتك الحالية بالبيانات الموجودة في الملف. لا يمكن التراجع عن هذا الإجراء.</p>;
            default: return <p>هل أنت متأكد من هذا الإجراء؟</p>;
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{title}</h2>
                    <button onClick={onClose} className="modal-close-btn" aria-label="إغلاق">&times;</button>
                </div>
                <form onSubmit={handleSubmit}>
                    <div className="modal-body">{renderForm()}</div>
                    <div className="modal-footer">
                        <button type="button" onClick={onClose} className="modal-cancel-btn">إلغاء</button>
                        <button type="submit" className={`modal-submit-btn ${type === 'clear-all-data' || type === 'confirm-import' ? 'danger' : ''}`}>تأكيد</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const BarChart: React.FC<{ data: { label: string; income: number; expenses: number }[] }> = ({ data }) => {
    const maxValue = Math.max(...data.flatMap(d => [d.income, d.expenses]), 1000); // Ensure a minimum height
    const chartHeight = 200;

    return (
        <div className="chart-container">
            {data.map((d, i) => (
                <div key={i} className="chart-bar-group">
                    <div className="chart-bar income" style={{ height: `${(d.income / maxValue) * chartHeight}px` }} title={`الدخل: ${d.income.toLocaleString()} جنيه`}></div>
                    <div className="chart-bar expenses" style={{ height: `${(d.expenses / maxValue) * chartHeight}px` }} title={`المصاريف: ${d.expenses.toLocaleString()} جنيه`}></div>
                    <div className="chart-label">{d.label}</div>
                </div>
            ))}
        </div>
    );
};

const CalculatorTab: React.FC<CalculatorTabProps> = ({ appData, setAppData, handleOpenModal, setNotification }) => {
    const [currentListName, setCurrentListName] = useState('');
    const [currentListItems, setCurrentListItems] = useState<CalculationListItem[]>([]);
    const [selectedMaterialId, setSelectedMaterialId] = useState('');
    const [quantity, setQuantity] = useState(1);
    
    const { pricedMaterials, savedCalculations } = appData;

    const handleAddItem = () => {
        if (!selectedMaterialId || quantity <= 0) return;
        const material = pricedMaterials.find(m => m.id === selectedMaterialId);
        if (!material) return;

        const newItem: CalculationListItem = {
            materialId: material.id,
            materialName: material.name,
            quantity,
            unit: material.unit,
            price: material.price,
            total: quantity * material.price,
        };
        setCurrentListItems(prev => [...prev, newItem]);
        setSelectedMaterialId('');
        setQuantity(1);
    };

    const handleRemoveItem = (index: number) => {
        setCurrentListItems(prev => prev.filter((_, i) => i !== index));
    };

    const handleSaveList = () => {
        if (!currentListName.trim() || currentListItems.length === 0) {
            setNotification('اكتب اسم للقائمة وضيف خامات الأول.');
            return;
        }
        const totalCost = currentListItems.reduce((sum, item) => sum + item.total, 0);
        const newList: CalculationList = {
            id: `calc-${Date.now()}`,
            name: currentListName,
            items: currentListItems,
            totalCost,
            createdAt: Date.now(),
        };
        setAppData(prev => ({...prev, savedCalculations: [newList, ...prev.savedCalculations]}));
        setNotification(`تم حفظ قائمة "${currentListName}".`);
        setCurrentListName('');
        setCurrentListItems([]);
    };

    const handleDeleteSavedList = (id: string) => {
        if (confirm('متأكد إنك عايز تمسح القائمة دي؟')) {
            setAppData(prev => ({...prev, savedCalculations: prev.savedCalculations.filter(l => l.id !== id)}));
            setNotification('تم حذف القائمة.');
        }
    };
    
    const handleDeletePricedMaterial = (id: string) => {
        if (confirm('متأكد إنك عايز تمسح الخامة دي من قائمة أسعارك؟')) {
            setAppData(prev => ({...prev, pricedMaterials: prev.pricedMaterials.filter(m => m.id !== id)}));
            setNotification('تم حذف الخامة من الأسعار.');
        }
    };

    const totalCurrentCost = currentListItems.reduce((sum, item) => sum + item.total, 0);

    return (
        <div className="calculator-container">
            <div className="calculator-section">
                <h3>قائمة الأسعار الخاصة بيك</h3>
                <p>هنا بتسجل أسعار الخامات اللي بتستخدمها عشان تقدر تسعر شغلك بسهولة.</p>
                <div className="priced-materials-list">
                    {pricedMaterials.length > 0 ? (
                        pricedMaterials.map(material => (
                            <div key={material.id} className="priced-material-item">
                                <span>{material.name} ({material.unit})</span>
                                <span className="price">{material.price.toLocaleString()} جنيه</span>
                                <div className="actions">
                                     <button onClick={() => handleOpenModal('edit-priced-material', material)} title="تعديل السعر">✏️</button>
                                     <button onClick={() => handleDeletePricedMaterial(material.id)} title="حذف الخامة">🗑️</button>
                                </div>
                            </div>
                        ))
                    ) : (
                        <div className="enhanced-empty-state small">
                            <p>لسه مسجلتش أي أسعار. ابدأ دلوقتي!</p>
                        </div>
                    )}
                </div>
                <button className="add-btn" onClick={() => handleOpenModal('add-priced-material')}>+ إضافة خامة جديدة للأسعار</button>
            </div>

            <div className="calculator-section">
                <h3>حساب تكلفة شغل جديد</h3>
                <p>اختار من الخامات اللي سعرها متسجل عندك عشان تحسب تكلفة أي شغلانة.</p>
                
                <div className="calculation-form">
                    <input 
                        type="text" 
                        value={currentListName} 
                        onChange={(e) => setCurrentListName(e.target.value)}
                        placeholder="اسم القائمة (مثال: تكلفة كنبة مودرن)" 
                    />
                    <div className="add-item-form">
                        <select value={selectedMaterialId} onChange={e => setSelectedMaterialId(e.target.value)} disabled={pricedMaterials.length === 0}>
                            <option value="">اختار خامة...</option>
                            {pricedMaterials.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </select>
                        <input type="number" value={quantity} onChange={e => setQuantity(Number(e.target.value))} placeholder="الكمية" min="1" />
                        <button onClick={handleAddItem} disabled={!selectedMaterialId}>+</button>
                    </div>
                </div>

                {currentListItems.length > 0 && (
                    <div className="current-calculation-list">
                        <h4>الخامات في القائمة الحالية:</h4>
                        <ul>
                            {currentListItems.map((item, index) => (
                                <li key={index}>
                                    <span>{item.materialName} ({item.quantity} {item.unit})</span>
                                    <span>{item.total.toLocaleString()} جنيه</span>
                                    <button onClick={() => handleRemoveItem(index)}>&times;</button>
                                </li>
                            ))}
                        </ul>
                        <div className="calculation-total">
                            <span>الإجمالي</span>
                            <span>{totalCurrentCost.toLocaleString()} جنيه</span>
                        </div>
                        <button className="save-btn" onClick={handleSaveList} disabled={!currentListName.trim()}>حفظ القائمة</button>
                    </div>
                )}
            </div>
             <div className="calculator-section" style={{ gridColumn: '1 / -1' }}>
                <h3>قوائم الحسابات المحفوظة</h3>
                <div className="saved-calculations-grid">
                    {savedCalculations.length > 0 ? (
                        savedCalculations.map(calc => (
                             <div key={calc.id} className="saved-calc-card">
                                 <h4>{calc.name}</h4>
                                 <p className="total-cost">{calc.totalCost.toLocaleString()} جنيه</p>
                                 <p className="date">{new Date(calc.createdAt).toLocaleDateString('ar-EG')}</p>
                                 <button onClick={() => handleDeleteSavedList(calc.id)} className="delete-saved" title="حذف القائمة">🗑️</button>
                             </div>
                        ))
                    ) : (
                         <div className="enhanced-empty-state small" style={{ gridColumn: '1 / -1' }}>
                            <p>لسه معملتش أي قوائم حسابات.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};


// --- MAIN APP COMPONENT ---
const App: React.FC = () => {
    // --- STATE MANAGEMENT ---
    const [appData, setAppData] = useState<AppData>(getInitialState());
    const [activeTab, setActiveTab] = useState<Tab>('dashboard');
    const [theme, setTheme] = useState<Theme>('light');
    const [chat, setChat] = useState<Chat | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [notification, setNotification] = useState<string | null>(null);
    const [modalConfig, setModalConfig] = useState<{ type: string; data?: any; title: string } | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [sortBy, setSortBy] = useState<SortByType>('newest');
    const [isInstallHelpOpen, setIsInstallHelpOpen] = useState(false);
    
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const { orders, inventory, expenses, pricedMaterials, savedCalculations, notepad, chatHistory, lastBackupDate, notificationPermission } = appData;

    // --- HELPER FUNCTIONS ---
    const reinitializeChat = (history: Message[]) => {
        if (API_KEY) {
            const ai = new GoogleGenAI({ apiKey: API_KEY });
            const formattedHistory = history
                .filter(m => m.role === 'user' || m.role === 'assistant')
                .map(m => ({
                    role: m.role === 'assistant' ? 'model' : 'user',
                    parts: [{ text: m.text }]
                }));
            
            const newChat = ai.chats.create({
                model: 'gemini-2.5-flash',
                systemInstruction,
                tools,
                history: formattedHistory
            });
            setChat(newChat);
        }
    };

    // --- DATA PERSISTENCE, MIGRATION & CHAT INITIALIZATION ---
    useEffect(() => {
        const data = migrateAndLoadData();
        setAppData(data);

        // Load theme from localStorage
        const savedTheme = localStorage.getItem('workshopTheme') as Theme;
        if (savedTheme) setTheme(savedTheme);

        reinitializeChat(data.chatHistory);
    }, []);

    useEffect(() => {
        localStorage.setItem('workshopData', JSON.stringify(appData));
    }, [appData]);

    useEffect(() => { 
        localStorage.setItem('workshopTheme', theme); 
        document.documentElement.setAttribute('data-theme', theme); 
    }, [theme]);
    

    // --- NOTIFICATION & CHAT LOGIC ---
    useEffect(() => {
        if (notification) {
            const timer = setTimeout(() => setNotification(null), 3000);
            return () => clearTimeout(timer);
        }
    }, [notification]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [chatHistory]);
    
    useEffect(() => {
        const checkAndScheduleNotifications = () => {
            if (notificationPermission !== 'granted') return;

            orders.forEach(order => {
                if (order.deliveryDate) {
                    const delivery = new Date(order.deliveryDate).getTime();
                    const now = new Date().getTime();
                    const oneDay = 24 * 60 * 60 * 1000;

                    // This logic should be in a service worker to persist.
                    // For a web app, this only works if the app is open.
                    // A proper implementation requires server-side push notifications or more complex PWA features.
                    console.log(`Checking notification for order "${order.name}"`);
                }
            });
        };
        checkAndScheduleNotifications();
    }, [orders, notificationPermission]);


    // --- AI & TOOL FUNCTIONS ---
    const handleUserInput = async (text: string) => {
        if (!chat || isLoading) return;
        setIsLoading(true);
        const userMessage: Message = { id: `user-${Date.now()}`, role: 'user', text };
        setAppData(prev => ({...prev, chatHistory: [...prev.chatHistory, userMessage, { id: `loading-${Date.now()}`, role: 'loading', text: '...' }]}));

        try {
            const resultStream = await chat.sendMessageStream({ message: text });
            
            let finalAssistantResponse = '';
            let currentText = '';
            let toolCalls: any[] = [];

            setAppData(prev => ({...prev, chatHistory: [...prev.chatHistory.filter(m => m.role !== 'loading'), { id: `asst-stream-${Date.now()}`, role: 'assistant', text: '' }]}));

            for await (const chunk of resultStream) {
                if (chunk.functionCalls) {
                    toolCalls = chunk.functionCalls;
                }
                currentText += chunk.text;

                setAppData(prev => {
                    const newHistory = [...prev.chatHistory];
                    const lastMessage = newHistory[newHistory.length - 1];
                    if (lastMessage && lastMessage.role === 'assistant') {
                        lastMessage.text = currentText;
                    }
                    return {...prev, chatHistory: newHistory};
                });
            }
            finalAssistantResponse = currentText;

            if (toolCalls.length > 0) {
                 const call = toolCalls[0];
                 const toolMessage: Message = { id: `tool-${Date.now()}`, role: 'tool-call', text: `⚙️ جاري ${call.name}...` };
                 setAppData(prev => ({...prev, chatHistory: [...prev.chatHistory, toolMessage]}));

                 let functionResult: any;

                // --- TOOL EXECUTION LOGIC ---
                switch (call.name) {
                     case 'registerOrder': {
                        const { name, clientName, type, totalCost, paidAmount, laborCost } = call.args;
                        const newOrder: OrderItem = {
                            id: `order-${Date.now()}`,
                            name,
                            clientName,
                            type,
                            totalCost: Number(totalCost),
                            paidAmount: Number(paidAmount) || 0,
                            laborCost: Number(laborCost) || undefined,
                            status: 'progress',
                            createdAt: Date.now()
                        };
                        setAppData(prev => ({...prev, orders: [newOrder, ...prev.orders]}));
                        functionResult = { success: true, newOrder };
                        break;
                    }
                     case 'recordPayment': {
                        const { orderName, amount } = call.args;
                        let orderFound = false;
                        let updatedOrder: OrderItem | null = null;
                        const newOrders = appData.orders.map(order => {
                            if (!orderFound && (order.name.includes(orderName) || order.clientName.includes(orderName))) {
                                orderFound = true;
                                updatedOrder = { ...order, paidAmount: order.paidAmount + Number(amount) };
                                return updatedOrder;
                            }
                            return order;
                        });
                        if (orderFound) {
                            setAppData(prev => ({...prev, orders: newOrders}));
                        }
                        functionResult = updatedOrder ? { success: true, updatedOrder } : { success: false, message: "Order not found." };
                        break;
                    }
                    case 'updateOrderStatus': {
                        const { orderName, status } = call.args;
                        let orderFound = false;
                        let updatedOrder: OrderItem | null = null;
                        const newOrders = appData.orders.map(order => {
                            if (!orderFound && (order.name.includes(orderName) || order.clientName.includes(orderName))) {
                                orderFound = true;
                                updatedOrder = { ...order, status: status as OrderItem['status'] };
                                return updatedOrder;
                            }
                            return order;
                        });
                        if (orderFound) {
                           setAppData(prev => ({...prev, orders: newOrders}));
                        }
                        functionResult = updatedOrder ? { success: true, updatedOrder } : { success: false, message: "Order not found." };
                        break;
                    }
                    case 'deleteOrder': {
                        const { orderName } = call.args;
                        const originalLength = appData.orders.length;
                        const newOrders = appData.orders.filter(order => !(order.name.includes(orderName) || order.clientName.includes(orderName)));
                        const success = newOrders.length < originalLength;
                        if (success) {
                           setAppData(prev => ({...prev, orders: newOrders }));
                        }
                        functionResult = { success, message: success ? "Order deleted." : "Order not found." };
                        break;
                    }
                    case 'getDashboardSummary': {
                        const progressCount = appData.orders.filter(o => o.status === 'progress').length;
                        const totalDebt = appData.orders.reduce((sum, o) => sum + (o.totalCost - o.paidAmount), 0);
                        
                        const isThisMonth = (date: number) => {
                            const d = new Date(date);
                            const today = new Date();
                            return d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
                        };

                        const thisMonthIncome = appData.orders
                            .filter(o => isThisMonth(o.createdAt))
                            .reduce((sum, o) => sum + o.paidAmount, 0); 
                        
                        const thisMonthExpenses = appData.expenses
                            .filter(e => isThisMonth(e.date))
                            .reduce((sum, e) => sum + e.amount, 0);

                        const monthlyCraftsmanshipProfit = appData.orders
                            .filter(o => isThisMonth(o.createdAt) && o.laborCost)
                            .reduce((sum, o) => sum + o.laborCost!, 0);

                        functionResult = { progressCount, totalDebt, thisMonthIncome, thisMonthExpenses, monthlyCraftsmanshipProfit };
                        break;
                    }
                    case 'getOrderDetails': {
                        const { orderName } = call.args;
                        const order = appData.orders.find(o => o.name.includes(orderName) || o.clientName.includes(orderName));
                        functionResult = order ? { success: true, orderDetails: order } : { success: false, message: "Order not found." };
                        break;
                    }
                     case 'addExpense': {
                        const { description, amount } = call.args;
                        const newExpense: ExpenseItem = {
                            id: `exp-${Date.now()}`,
                            description,
                            amount: Number(amount),
                            date: Date.now()
                        };
                        setAppData(prev => ({...prev, expenses: [newExpense, ...prev.expenses]}));
                        functionResult = { success: true, expenseId: newExpense.id };
                        break;
                    }
                    case 'setDeliveryDate': {
                        const { orderName, deliveryDate } = call.args;
                        let date;
                        try {
                            date = new Date(deliveryDate);
                            if (isNaN(date.getTime())) { throw new Error("Invalid date format"); }
                       
                            let orderFound = false;
                            let updatedOrder: OrderItem | null = null;
                            const newOrders = appData.orders.map(order => {
                                if (!orderFound && (order.name.includes(orderName) || order.clientName.includes(orderName))) {
                                    orderFound = true;
                                    updatedOrder = { ...order, deliveryDate: date.getTime() };
                                    return updatedOrder;
                                }
                                return order;
                            });
                            if (orderFound) {
                                setAppData(prev => ({...prev, orders: newOrders}));
                            }
                            functionResult = updatedOrder ? { success: true, updatedOrder } : { success: false, message: "Order not found." };
                        } catch(e) {
                             functionResult = { success: false, message: "Invalid date format provided by model. Could not parse: " + deliveryDate };
                        }
                        break;
                    }
                    case 'calculateDetailedCost': {
                        const { items } = call.args;
                        let totalCost = 0;
                        let allItemsFound = true;
                        const calculatedItems: { name: string; quantity: number; unit?: string; cost?: number; found: boolean }[] = [];

                        Object.entries(items).forEach(([itemName, quantity]) => {
                            const material = appData.pricedMaterials.find(m => m.name.includes(itemName));
                            if (material) {
                                const cost = material.price * Number(quantity);
                                totalCost += cost;
                                calculatedItems.push({ name: itemName, quantity: Number(quantity), unit: material.unit, cost: cost, found: true });
                            } else {
                                calculatedItems.push({ name: itemName, quantity: Number(quantity), found: false });
                                allItemsFound = false;
                            }
                        });

                        functionResult = { totalCost, items: calculatedItems, allItemsFound };
                        break;
                    }
                    case 'addNotepadEntry': {
                        const { clientName, amount } = call.args;
                        const newEntry: NotepadEntry = { id: `note-${Date.now()}`, clientName, amount: Number(amount) };
                        setAppData(prev => ({ ...prev, notepad: [...prev.notepad, newEntry] }));
                        functionResult = { success: true, entryId: newEntry.id };
                        break;
                    }
                    case 'updateNotepadEntry': {
                        const { clientName, amountChange } = call.args;
                        let clientFound = false;
                        const newNotepad = appData.notepad.map(entry => {
                            if (entry.clientName.includes(clientName)) {
                                clientFound = true;
                                const newAmount = entry.amount + Number(amountChange);
                                return { ...entry, amount: newAmount < 0 ? 0 : newAmount }; // Prevent negative balance
                            }
                            return entry;
                        });
                        if (clientFound) {
                           setAppData(prev => ({ ...prev, notepad: newNotepad }));
                        }
                        functionResult = { success: clientFound, message: clientFound ? "Notepad updated." : "Client not found." };
                        break;
                    }
                }
                
                 const toolResponse = {
                    name: call.name,
                    response: functionResult,
                };
                 const toolResultStream = await chat.sendMessageStream({ toolResponse });
                 
                 let finalToolResponseText = '';
                 setAppData(prev => {
                     const historyWithoutToolCall = prev.chatHistory.filter(m => m.id !== toolMessage.id);
                     return {...prev, chatHistory: [...historyWithoutToolCall, { id: `asst-tool-resp-${Date.now()}`, role: 'assistant', text: '' }]};
                 });

                 for await (const chunk of toolResultStream) {
                    finalToolResponseText += chunk.text;
                    setAppData(prev => {
                        const newHistory = [...prev.chatHistory];
                        const lastMessage = newHistory[newHistory.length - 1];
                        if (lastMessage && lastMessage.role === 'assistant') {
                            lastMessage.text = finalToolResponseText;
                        }
                        return {...prev, chatHistory: newHistory};
                    });
                 }
            }
            
        } catch (error) {
            console.error(error);
            const historyWithoutLoading = chatHistory.filter(m => m.role !== 'loading');
            setAppData(prev => ({...prev, chatHistory: [...historyWithoutLoading, { id: `asst-err-${Date.now()}`, role: 'assistant', text: 'معلش، حصلت مشكلة. حاول تاني.' }]}));
        } finally {
            setIsLoading(false);
        }
    };


    // --- UI EVENT HANDLERS ---
    const toggleTheme = () => setTheme(prev => prev === 'light' ? 'dark' : 'light');

    const handleOpenModal = (type: string, data?: any) => {
        const titles: Record<string, string> = {
            'add-order': data?.type === 'old' ? 'إضافة شغل صيانة' : 'إضافة شغل جديد',
            'record-payment': 'تسجيل دفعة جديدة',
            'update-status': `تحديث حالة: ${data?.name}`,
            'set-delivery-date': `تحديد موعد تسليم: ${data?.name}`,
            'delete-order': 'تأكيد حذف الطلب',
            'add-inventory': 'إضافة خامة جديدة للمخزن',
            'update-inventory': `تحديث: ${data?.name}`,
            'add-expense': 'تسجيل مصروف جديد',
            'clear-finished-orders': 'تأكيد مسح الشغل المنتهي',
            'add-priced-material': 'إضافة خامة وأسعارها',
            'edit-priced-material': `تعديل سعر: ${data?.name}`,
            'add-notepad-entry': 'إضافة حساب جديد للنوتة',
            'edit-notepad-entry': `تعديل حساب: ${data?.clientName}`,
            'clear-all-data': 'تأكيد مسح كل البيانات',
            'confirm-import': 'تأكيد استيراد البيانات',
        };
        setModalConfig({ type, data, title: titles[type] || 'تأكيد الإجراء' });
    };

    const handleModalSubmit = (formData: any) => {
        if (!modalConfig) return;
        const data = modalConfig.data || {};
        switch (modalConfig.type) {
            case 'add-order':
                const newOrder: OrderItem = {
                    id: `order-${Date.now()}`,
                    name: formData.name,
                    clientName: formData.clientName,
                    type: formData.type as 'new' | 'old',
                    totalCost: Number(formData.totalCost),
                    paidAmount: Number(formData.paidAmount) || 0,
                    laborCost: Number(formData.laborCost) || undefined,
                    status: 'progress',
                    createdAt: Date.now()
                };
                setAppData(prev => ({...prev, orders: [newOrder, ...prev.orders]}));
                setNotification('تم إضافة الطلب بنجاح.');
                break;
            case 'record-payment':
                setAppData(prev => ({...prev, orders: prev.orders.map(o => o.id === data.id ? { ...o, paidAmount: o.paidAmount + Number(formData.amount) } : o)}));
                setNotification('تم تسجيل الدفعة بنجاح.');
                break;
            case 'update-status':
                setAppData(prev => ({...prev, orders: prev.orders.map(o => o.id === data.id ? { ...o, status: formData.status } : o)}));
                setNotification('تم تحديث الحالة بنجاح.');
                break;
            case 'set-delivery-date': {
                const [year, month, day] = formData.deliveryDate.split('-').map(Number);
                // Create date at midnight in local timezone to avoid UTC interpretation issues
                const deliveryTimestamp = new Date(year, month - 1, day).getTime();
                setAppData(prev => ({...prev, orders: prev.orders.map(o => o.id === data.id ? { ...o, deliveryDate: deliveryTimestamp } : o)}));
                setNotification('تم تحديد موعد التسليم بنجاح.');
                break;
            }
            case 'delete-order':
                setAppData(prev => ({...prev, orders: prev.orders.filter(o => o.id !== data.id)}));
                setNotification('تم حذف الطلب بنجاح.');
                break;
             case 'add-inventory':
                const newItem: InventoryItem = { id: `inv-${Date.now()}`, name: formData.name, quantity: Number(formData.quantity), unit: formData.unit, price: Number(formData.price) };
                setAppData(prev => ({...prev, inventory: [newItem, ...prev.inventory]}));
                setNotification('تمت إضافة الخامة للمخزن.');
                break;
            case 'update-inventory':
                setAppData(prev => ({...prev, inventory: prev.inventory.map(item => item.id === data.id ? { ...item, quantity: Number(formData.quantity), price: Number(formData.price) } : item)}));
                setNotification('تم تحديث كمية الخامة.');
                break;
            case 'add-expense':
                const newExpense: ExpenseItem = { id: `exp-${Date.now()}`, description: formData.description, amount: Number(formData.amount), date: Date.now() };
                setAppData(prev => ({...prev, expenses: [newExpense, ...prev.expenses]}));
                setNotification('تم تسجيل المصروف.');
                break;
            case 'clear-finished-orders':
                setAppData(prev => ({...prev, orders: prev.orders.filter(o => o.status !== 'finished')}));
                setNotification('تم مسح كل الطلبات المنتهية.');
                break;
            case 'add-priced-material':
                const newMaterial: PricedMaterial = { id: `pm-${Date.now()}`, name: formData.name, unit: formData.unit, price: Number(formData.price) };
                setAppData(prev => ({...prev, pricedMaterials: [newMaterial, ...prev.pricedMaterials]}));
                setNotification('تمت إضافة الخامة لقائمة الأسعار.');
                break;
            case 'edit-priced-material':
                setAppData(prev => ({...prev, pricedMaterials: prev.pricedMaterials.map(m => m.id === data.id ? { ...m, price: Number(formData.price) } : m)}));
                setNotification('تم تعديل السعر.');
                break;
            case 'add-notepad-entry':
                const newEntry: NotepadEntry = { id: `note-${Date.now()}`, clientName: formData.clientName, amount: Number(formData.amount) };
                setAppData(prev => ({...prev, notepad: [...prev.notepad, newEntry]}));
                setNotification('تمت إضافة الحساب للنوتة.');
                break;
            case 'edit-notepad-entry':
                setAppData(prev => ({...prev, notepad: prev.notepad.map(n => n.id === data.id ? { ...n, amount: Number(formData.amount) } : n)}));
                setNotification('تم تعديل الحساب.');
                break;
             case 'clear-all-data':
                handleClearAllData();
                break;
             case 'confirm-import': {
                const cleanData = migrateAndLoadData(modalConfig.data);
                setAppData(cleanData);
                reinitializeChat(cleanData.chatHistory);
                setNotification('تم استيراد البيانات بنجاح.');
                break;
            }
        }
        setModalConfig(null);
    };
    
    const handleClearFinished = () => {
        handleOpenModal('clear-finished-orders');
    };
    
     const handleClearAllData = () => {
        localStorage.removeItem('workshopData');
        window.location.reload();
    };

    const handleDeleteExpense = (id: string) => {
        if (confirm('متأكد إنك عايز تمسح المصروف ده؟')) {
            setAppData(prev => ({...prev, expenses: prev.expenses.filter(e => e.id !== id)}));
            setNotification('تم حذف المصروف.');
        }
    };
    
    const handleDeleteInventoryItem = (id: string) => {
         if (confirm('متأكد إنك عايز تمسح الخامة دي من المخزن؟')) {
            setAppData(prev => ({...prev, inventory: prev.inventory.filter(i => i.id !== id)}));
            setNotification('تم حذف الخامة.');
        }
    };
    
    const handleDeleteNotepadEntry = (id: string) => {
         if (confirm('متأكد إنك عايز تمسح الحساب ده من النوتة؟')) {
            setAppData(prev => ({...prev, notepad: prev.notepad.filter(n => n.id !== id)}));
            setNotification('تم حذف الحساب.');
        }
    };

    const handleExportData = () => {
        const dataToSave = { ...appData, lastBackupDate: Date.now() };
        const blob = new Blob([JSON.stringify(dataToSave, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const dateStr = new Date().toISOString().split('T')[0];
        a.download = `workshop_backup_${dateStr}.json`;
        a.click();
        URL.revokeObjectURL(url);
        setAppData(prev => ({...prev, lastBackupDate: Date.now() }));
        setNotification('تم تصدير نسخة احتياطية بنجاح.');
    };

    const handleImportData = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const text = e.target?.result as string;
                const rawData = JSON.parse(text);
                handleOpenModal('confirm-import', rawData);
            } catch (error) {
                console.error('Failed to import data:', error);
                setNotification('فشل استيراد الملف. تأكد إنه ملف صحيح.');
            }
        };
        reader.readAsText(file);
        event.target.value = ''; // Reset file input
    };
    
    const handleRequestNotifications = async () => {
        if (!('Notification' in window)) {
            setNotification("المتصفح بتاعك مش بيدعم الإشعارات.");
            return;
        }

        const permission = await window.Notification.requestPermission();
        setAppData(prev => ({...prev, notificationPermission: permission }));
        if (permission === 'granted') {
            setNotification('تمام، الإشعارات اتفعلت!');
            new window.Notification('ورشة عبدو', {
                body: 'كده الإشعارات شغالة وهنفكرك بالمواعيد.',
                icon: '/icons/icon-192x192.png'
            });
        } else {
            setNotification('معلش، لازم توافق عشان الإشعارات تشتغل.');
        }
    };

    // --- RENDER LOGIC & DERIVED STATE ---
    const filteredOrders = orders
        .filter(order => order && order.name && order.name.toLowerCase().includes(searchTerm.toLowerCase()));

    const sortedOrders = [...filteredOrders].sort((a, b) => {
        if (sortBy === 'newest') return b.createdAt - a.createdAt;
        if (sortBy === 'oldest') return a.createdAt - b.createdAt;
        if (sortBy === 'name') return a.name.localeCompare(b.name);
        return 0;
    });
    
    const scheduledOrders = orders
        .filter(o => o.deliveryDate)
        .sort((a, b) => (a.deliveryDate || 0) - (b.deliveryDate || 0));

    const totalDebt = orders.reduce((sum, o) => sum + (o.totalCost - o.paidAmount), 0);
    const totalNotepadDebt = notepad.reduce((sum, n) => sum + n.amount, 0);
    
    const isToday = (someDate: number) => {
        const today = new Date();
        const date = new Date(someDate);
        return date.getDate() === today.getDate() &&
               date.getMonth() === today.getMonth() &&
               date.getFullYear() === today.getFullYear();
    };

    const isThisMonth = (someDate: number) => {
        const today = new Date();
        const date = new Date(someDate);
        return date.getMonth() === today.getMonth() &&
               date.getFullYear() === today.getFullYear();
    };
    
    const todaysDeliveries = scheduledOrders.filter(o => isToday(o.deliveryDate || 0));
    const newOrdersToday = orders.filter(o => isToday(o.createdAt));
    const monthlyCraftsmanshipProfit = orders
        .filter(o => isThisMonth(o.createdAt) && o.laborCost)
        .reduce((sum, o) => sum + (o.laborCost || 0), 0);


    const getChartData = () => {
        const months: { [key: string]: { label: string, income: number, expenses: number } } = {};
        const monthNames = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
        
        for (let i = 2; i >= 0; i--) {
            const d = new Date();
            d.setMonth(d.getMonth() - i);
            const monthKey = `${d.getFullYear()}-${d.getMonth()}`;
            if (!months[monthKey]) {
                months[monthKey] = { label: monthNames[d.getMonth()], income: 0, expenses: 0 };
            }
        }
        
        orders.forEach(order => {
            if (!order || !order.createdAt) return;
            const date = new Date(order.createdAt);
            const monthKey = `${date.getFullYear()}-${date.getMonth()}`;
            if (months[monthKey] && order.paidAmount > 0) {
                months[monthKey].income += order.paidAmount;
            }
        });
        expenses.forEach(expense => {
            if (!expense || !expense.date) return;
            const date = new Date(expense.date);
            const monthKey = `${date.getFullYear()}-${date.getMonth()}`;
            if (months[monthKey]) {
                months[monthKey].expenses += expense.amount;
            }
        });

        return Object.values(months);
    };

    return (
        <>
            <header>
                <div className="header-content">
                     <div className="header-left">
                         <button onClick={toggleTheme} className="theme-switcher" aria-label={`تغيير للوضع ${theme === 'light' ? 'المظلم' : 'الفاتح'}`}>
                             {theme === 'light' ? '🌙' : '☀️'}
                         </button>
                     </div>
                     <div className="header-title-container">
                        <img src={logoBase64} alt="شعار الورشة" className="header-logo" />
                        <h1>ورشة عبدو</h1>
                     </div>
                     <div className="header-right">
                        <button onClick={() => setIsInstallHelpOpen(true)} className="help-button" aria-label="كيفية تثبيت التطبيق">؟</button>
                     </div>
                </div>
                <nav className="app-nav">
                    <button onClick={() => setActiveTab('dashboard')} className={activeTab === 'dashboard' ? 'active' : ''}>الرئيسية</button>
                    <button onClick={() => setActiveTab('orders')} className={activeTab === 'orders' ? 'active' : ''}>الطلبات</button>
                    <button onClick={() => setActiveTab('notepad')} className={activeTab === 'notepad' ? 'active' : ''}>النوتة</button>
                    <button onClick={() => setActiveTab('schedule')} className={activeTab === 'schedule' ? 'active' : ''}>مواعيد التسليم</button>
                    <button onClick={() => setActiveTab('calculator')} className={activeTab === 'calculator' ? 'active' : ''}>حاسبة الخامات</button>
                    <button onClick={() => setActiveTab('warehouse')} className={activeTab === 'warehouse' ? 'active' : ''}>المخزن</button>
                    <button onClick={() => setActiveTab('expenses')} className={activeTab === 'expenses' ? 'active' : ''}>المصاريف</button>
                </nav>
            </header>

            <main>
                {activeTab === 'dashboard' && (
                    <div className="dashboard-container">
                         <h2>لوحة التحكم</h2>
                         <div className="stats-grid">
                            <div className="stat-card"><h3>{orders.filter(o => o.status === 'progress').length}</h3><p>طلب شغال</p></div>
                            <div className="stat-card"><h3>{(totalDebt + totalNotepadDebt).toLocaleString()}</h3><p>إجمالي المديونيات (جنيه)</p></div>
                             <div className="stat-card"><h3>{monthlyCraftsmanshipProfit.toLocaleString()}</h3><p>أرباح المصنعية (الشهر)</p></div>
                             <div className="stat-card"><h3>{todaysDeliveries.length}</h3><p>تسليمات النهاردة</p></div>
                         </div>
                         
                          <div className="daily-briefing-card">
                             <h3>ملخص اليوم</h3>
                             <div className="briefing-content">
                                 <div className="briefing-section">
                                     <h4>تسليمات النهاردة ({todaysDeliveries.length})</h4>
                                     {todaysDeliveries.length > 0 ? (
                                         <ul>{todaysDeliveries.map(o => <li key={o.id}>{o.name} - {o.clientName}</li>)}</ul>
                                     ) : <p>لا يوجد تسليمات اليوم.</p>}
                                 </div>
                                 <div className="briefing-section">
                                     <h4>طلبات جديدة اليوم ({newOrdersToday.length})</h4>
                                     {newOrdersToday.length > 0 ? (
                                         <ul>{newOrdersToday.map(o => <li key={o.id}>{o.name} - {o.clientName}</li>)}</ul>
                                     ) : <p>لم يتم تسجيل طلبات جديدة اليوم.</p>}
                                 </div>
                             </div>
                          </div>
                         
                          <div className="chart-wrapper">
                             <div className="chart-legend">
                                <span className="legend-item income">الدخل</span>
                                <span className="legend-item expenses">المصاريف</span>
                             </div>
                             <BarChart data={getChartData()} />
                          </div>
                          
                           <div className="data-management-section">
                             <h2>🔔 إشعارات مواعيد التسليم</h2>
                                <p className="data-management-info">
                                    {notificationPermission === 'granted' && 'الإشعارات مفعلة. هفكرك قبل أي معاد بيوم وفي نفس يوم التسليم.'}
                                    {notificationPermission === 'default' && 'فعل الإشعارات عشان أفكرك بمواعيد التسليم المهمة حتى لو قافل التطبيق.'}
                                    {notificationPermission === 'denied' && 'أنت رفضت الإشعارات. لو حبيت تفعلها، لازم تعملها من إعدادات المتصفح.'}
                                </p>
                                {notificationPermission === 'default' && (
                                    <div className="data-actions">
                                        <button onClick={handleRequestNotifications}>تفعيل الإشعارات</button>
                                    </div>
                                )}
                            </div>

                           <div className="data-management-section">
                               <h2>💾 النسخ الاحتياطي والاستعادة</h2>
                               <p className="data-management-info">
                                   شغلك بيتحفظ على الجهاز ده بس. عشان تضمن إن شغلك في أمان لو الجهاز ضاع أو باظ، اعمل نسخة احتياطية بانتظام واحفظها في مكان آمن زي جوجل درايف أو ابعتها لنفسك.
                                   <br/>
                                   <strong>آخر نسخة احتياطية:</strong> {lastBackupDate ? new Date(lastBackupDate).toLocaleString('ar-EG') : 'لم يتم عمل نسخة بعد'}
                                </p>
                               <div className="data-actions">
                                   <button onClick={handleExportData}>📤 تصدير نسخة احتياطية</button>
                                   <label className="data-import-btn">
                                       📥 استيراد نسخة احتياطية
                                       <input type="file" accept=".json" onChange={handleImportData} style={{ display: 'none' }} />
                                   </label>
                               </div>
                               <div className="reset-section">
                                   <button onClick={() => handleOpenModal('clear-all-data')} className="reset-btn">مسح كل البيانات والبدء من جديد</button>
                               </div>
                           </div>
                    </div>
                )}
                {activeTab === 'orders' && (
                    <div className="orders-container">
                        <div className="page-header-action">
                             <h2>قائمة الطلبات</h2>
                             <div className="action-buttons-group">
                                 <button onClick={() => handleOpenModal('add-order', { type: 'new' })}>+ شغل جديد</button>
                                 <button onClick={() => handleOpenModal('add-order', { type: 'old' })}>+ شغل صيانة</button>
                             </div>
                        </div>
                        <div className="orders-controls">
                           <div className="controls-left">
                                <input 
                                    type="text" 
                                    placeholder="ابحث عن طلب..." 
                                    className="search-input"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                                <div className="sort-buttons">
                                    <span>ترتيب حسب:</span>
                                    <button onClick={() => setSortBy('newest')} className={sortBy === 'newest' ? 'active' : ''}>الأحدث</button>
                                    <button onClick={() => setSortBy('oldest')} className={sortBy === 'oldest' ? 'active' : ''}>الأقدم</button>
                                    <button onClick={() => setSortBy('name')} className={sortBy === 'name' ? 'active' : ''}>الاسم</button>
                                </div>
                            </div>
                           {orders.some(o => o.status === 'finished') && (
                               <button onClick={handleClearFinished} className="clear-finished-btn">🗑️ مسح الشغل المنتهي</button>
                           )}
                        </div>
                        {sortedOrders.length > 0 ? (
                            <div className="orders-grid">
                                {sortedOrders.map(order => <OrderCard key={order.id} order={order} onOpenModal={handleOpenModal} />)}
                            </div>
                        ) : (
                             <div className="enhanced-empty-state">
                                <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" fill="currentColor" viewBox="0 0 16 16"><path d="M14.5 3a.5.5 0 0 1 .5.5v9a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5h13zm-13-1A1.5 1.5 0 0 0 0 3.5v9A1.5 1.5 0 0 0 1.5 14h13a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 14.5 2h-13z"/><path d="M5 8a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7A.5.5 0 0 1 5 8zm0-2.5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5zm0 5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5z"/><path d="M2 4.5a.5.5 0 0 1 .5-.5h.5a.5.5 0 0 1 .5.5v.5a.5.5 0 0 1-.5.5h-.5a.5.5 0 0 1-.5-.5v-.5zm0 2a.5.5 0 0 1 .5-.5h.5a.5.5 0 0 1 .5.5v.5a.5.5 0 0 1-.5.5h-.5a.5.5 0 0 1-.5-.5v-.5zm0 2a.5.5 0 0 1 .5-.5h.5a.5.5 0 0 1 .5.5v.5a.5.5 0 0 1-.5.5h-.5a.5.5 0 0 1-.5-.5v-.5z"/></svg>
                                <p>مفيش أي طلبات متسجلة دلوقتي. استخدم أزرار "+ شغل جديد" أو "+ شغل صيانة" عشان تسجل أول طلب!</p>
                             </div>
                        )}
                    </div>
                )}
                 {activeTab === 'notepad' && (
                    <div className="notepad-container">
                        <div className="page-header-action">
                            <h2>النوتة</h2>
                            <button onClick={() => handleOpenModal('add-notepad-entry')}>+ إضافة حساب جديد</button>
                        </div>
                        <div className="notepad-summary-card">
                            <h3>إجمالي الفلوس اللي ليك بره</h3>
                            <p>{totalNotepadDebt.toLocaleString()} جنيه</p>
                        </div>
                        {notepad.length > 0 ? (
                            <div className="notepad-grid">
                                {notepad.map(entry => (
                                    <div key={entry.id} className="notepad-card">
                                        <h4>{entry.clientName}</h4>
                                        <p>{entry.amount.toLocaleString()} جنيه</p>
                                        <div className="notepad-card-actions">
                                            <button onClick={() => handleOpenModal('edit-notepad-entry', entry)}>تعديل</button>
                                            <button onClick={() => handleDeleteNotepadEntry(entry.id)} className="delete-btn">حذف</button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                             <div className="enhanced-empty-state">
                                 <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" fill="currentColor" viewBox="0 0 16 16"><path d="M3.5 0a.5.5 0 0 1 .5.5V1h8V.5a.5.5 0 0 1 1 0V1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h1V.5a.5.5 0 0 1 .5-.5zM1 4v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4H1z"/><path d="M4.5 10.5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5z"/></svg>
                                <p>النوتة فاضية. ابدأ بتسجيل أول حساب.</p>
                                <button onClick={() => handleOpenModal('add-notepad-entry')}>+ إضافة أول حساب</button>
                             </div>
                        )}
                    </div>
                )}
                {activeTab === 'warehouse' && (
                    <div className="warehouse-container">
                        <div className="page-header-action">
                            <h2>المخزن</h2>
                            <button onClick={() => handleOpenModal('add-inventory')}>+ إضافة خامة</button>
                        </div>
                        {inventory.length > 0 ? (
                            <div className="inventory-list">
                                {inventory.map(item => (
                                    <div key={item.id} className="inventory-item">
                                        <div className="item-info">
                                            <h4>{item.name}</h4>
                                            <p>{item.quantity} {item.unit}</p>
                                            <p className="item-price">سعر الوحدة: {item.price.toLocaleString()} جنيه</p>
                                        </div>
                                        <div className="item-actions">
                                            <button className="action-btn" onClick={() => handleOpenModal('update-inventory', item)}>تحديث</button>
                                            <button className="action-btn delete-btn" onClick={() => handleDeleteInventoryItem(item.id)}>حذف</button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="enhanced-empty-state">
                                 <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" fill="currentColor" viewBox="0 0 16 16"><path d="M8 1.5A2.5 2.5 0 0 1 10.5 4h-5A2.5 2.5 0 0 1 8 1.5zm3.5 1.5a.5.5 0 0 0-.5-.5h-6a.5.5 0 0 0 0 1h6a.5.5 0 0 0 .5-.5zM12 5H4a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1zM4 4a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H4z"/></svg>
                                <p>المخزن فاضي. ابدأ بتسجيل الخامات اللي عندك.</p>
                                <button onClick={() => handleOpenModal('add-inventory')}>+ إضافة أول خامة</button>
                            </div>
                        )}
                    </div>
                )}
                {activeTab === 'expenses' && (
                     <div className="expenses-container">
                        <div className="page-header-action">
                             <h2>المصاريف</h2>
                             <button onClick={() => handleOpenModal('add-expense')}>+ تسجيل مصروف</button>
                        </div>
                         {expenses.length > 0 ? (
                            <div className="expenses-list">
                                {expenses.map(expense => (
                                    <div key={expense.id} className="expense-card">
                                        <div className="expense-info">
                                            <h4>{expense.description}</h4>
                                            <p className="expense-amount">{expense.amount.toLocaleString()} جنيه</p>
                                            <p className="expense-date">{new Date(expense.date).toLocaleDateString('ar-EG')}</p>
                                        </div>
                                        <div className="expense-actions">
                                            <button className="action-btn delete-btn" onClick={() => handleDeleteExpense(expense.id)}>حذف</button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="enhanced-empty-state">
                                <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" fill="currentColor" viewBox="0 0 16 16"><path d="M4 3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H4zm0-1h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><path d="M4.5 5.5a.5.5 0 0 1 .5-.5h6a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-6a.5.5 0 0 1-.5-.5v-1zm0 3a.5.5 0 0 1 .5-.5h6a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-6a.5.5 0 0 1-.5-.5v-1zm0 3a.5.5 0 0 1 .5-.5h6a.5.5 0 0 1 0 1h-6a.5.5 0 0 1-.5-.5zm2-8a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 0 1h-2a.5.5 0 0 1-.5-.5z"/></svg>
                                <p>لسه مسجلتش أي مصاريف. سجل أول مصروف عشان تحسب أرباحك صح.</p>
                                <button onClick={() => handleOpenModal('add-expense')}>+ تسجيل أول مصروف</button>
                             </div>
                        )}
                     </div>
                )}
                 {activeTab === 'schedule' && (
                    <div className="schedule-container">
                        <h2>مواعيد التسليم القادمة</h2>
                        {scheduledOrders.length > 0 ? (
                            <div className="schedule-list">
                                {scheduledOrders.map(order => <ScheduleCard key={order.id} order={order} />)}
                            </div>
                        ) : (
                            <div className="enhanced-empty-state">
                                <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" fill="currentColor" viewBox="0 0 16 16"><path d="M11 6.5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5v-1zm-3 0a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5v-1zm-5 3a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5v-1zm3 0a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5v-1z"/><path d="M3.5 0a.5.5 0 0 1 .5.5V1h8V.5a.5.5 0 0 1 1 0V1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h1V.5a.5.5 0 0 1 .5-.5zM1 4v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4H1z"/></svg>
                                <p>مفيش أي مواعيد تسليم متسجلة دلوقتي.</p>
                            </div>
                        )}
                    </div>
                )}
                {activeTab === 'calculator' && (
                   <CalculatorTab 
                       appData={appData}
                       setAppData={setAppData}
                       handleOpenModal={handleOpenModal}
                       setNotification={setNotification}
                   />
                )}
            </main>

            {isChatOpen && (
                <div className="chat-modal-overlay" onClick={() => setIsChatOpen(false)}>
                    <div className="chat-modal-content" onClick={e => e.stopPropagation()}>
                        <div className="chat-modal-header">
                            <h2>المساعد الذكي</h2>
                            <button onClick={() => setIsChatOpen(false)} className="modal-close-btn">&times;</button>
                        </div>
                        <div className="chat-container">
                             <div className="message-list" ref={messagesEndRef}>
                                {chatHistory.map((msg, index) => (
                                    <div key={msg.id || index} className={`message ${msg.role}`}>
                                        <div className="message-content">
                                            {msg.role === 'loading' ? (
                                                <><div className="dot"></div><div className="dot"></div><div className="dot"></div></>
                                            ) : (
                                                msg.text.split('\n').map((line, i) => <p key={i} style={{ margin: 0 }}>{line}</p>)
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <ChatInput onUserInput={handleUserInput} isLoading={isLoading} />
                        </div>
                    </div>
                </div>
            )}

            <button className="fab" onClick={() => setIsChatOpen(true)} aria-label="فتح المساعد الذكي">💬</button>

            {notification && <Notification message={notification} />}

            {modalConfig && <Modal config={modalConfig} onClose={() => setModalConfig(null)} onSubmit={handleModalSubmit} />}

            {isInstallHelpOpen && (
                <div className="modal-overlay" onClick={() => setIsInstallHelpOpen(false)}>
                    <div className="modal-content install-help-modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>كيفية تثبيت التطبيق</h2>
                            <button onClick={() => setIsInstallHelpOpen(false)} className="modal-close-btn" aria-label="إغلاق">&times;</button>
                        </div>
                        <div className="modal-body">
                            <p>عشان التطبيق يبقى على جهازك زيه زي أي تطبيق تاني، اتبع الخطوات دي:</p>
                            
                            <h4>📱 على أندرويد (متصفح كروم)</h4>
                            <ul>
                                <li>دوس على الثلاث نقط (القائمة) فوق على الشمال.</li>
                                <li>اختار "تثبيت التطبيق" أو "Add to Home screen".</li>
                            </ul>

                            <h4>📱 على آيفون (متصفح سفاري)</h4>
                            <ul>
                                <li>دوس على زرار المشاركة (مربع طالع منه سهم لفوق).</li>
                                <li>انزل تحت واختار "إضافة إلى الشاشة الرئيسية" أو "Add to Home Screen".</li>
                            </ul>

                            <h4>💻 على الكمبيوتر (متصفح كروم أو إيدج)</h4>
                            <ul>
                                <li>بص في شريط العنوان فوق على الشمال، هتلاقي أيقونة شكلها شاشة وعليها سهم لتحت.</li>
                                <li>دوس عليها واختار "تثبيت" أو "Install".</li>
                            </ul>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<App />);