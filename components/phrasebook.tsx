"use client";

import { useMemo, useState } from "react";
import { Languages, Search, ShieldAlert, Utensils, MapPin, MessageCircle, ShoppingBag } from "lucide-react";

type Category = "Base" | "Spostamenti" | "Cibo" | "Acquisti" | "Emergenze";

type Phrase = {
  category: Category;
  italian: string;
  uzbek: string;
  uzbekPronunciation: string;
  russian: string;
  russianPronunciation: string;
};

const categories: Array<{ name: Category; icon: typeof MessageCircle }> = [
  { name: "Base", icon: MessageCircle },
  { name: "Spostamenti", icon: MapPin },
  { name: "Cibo", icon: Utensils },
  { name: "Acquisti", icon: ShoppingBag },
  { name: "Emergenze", icon: ShieldAlert }
];

const phrases: Phrase[] = [
  { category: "Base", italian: "Buongiorno / Salve", uzbek: "Assalomu alaykum", uzbekPronunciation: "assalòmu alàikum", russian: "Здравствуйте", russianPronunciation: "zdràstvuite" },
  { category: "Base", italian: "Ciao", uzbek: "Salom", uzbekPronunciation: "salòm", russian: "Привет", russianPronunciation: "privèt" },
  { category: "Base", italian: "Grazie", uzbek: "Rahmat", uzbekPronunciation: "ràhmat", russian: "Спасибо", russianPronunciation: "spasìba" },
  { category: "Base", italian: "Per favore / Prego", uzbek: "Iltimos", uzbekPronunciation: "iltimòs", russian: "Пожалуйста", russianPronunciation: "pajàlusta" },
  { category: "Base", italian: "Sì / No", uzbek: "Ha / Yo‘q", uzbekPronunciation: "ha / yok", russian: "Да / Нет", russianPronunciation: "da / niet" },
  { category: "Base", italian: "Mi scusi", uzbek: "Kechirasiz", uzbekPronunciation: "kechiràsiz", russian: "Извините", russianPronunciation: "izvinìte" },
  { category: "Base", italian: "Non capisco", uzbek: "Men tushunmayman", uzbekPronunciation: "men tushunmàiman", russian: "Я не понимаю", russianPronunciation: "ya ni panimàiu" },
  { category: "Base", italian: "Parla inglese?", uzbek: "Ingliz tilida gapirasizmi?", uzbekPronunciation: "inglìz tilidà gapiràsizmi", russian: "Вы говорите по-английски?", russianPronunciation: "vy gavarìte pa-anglìiski" },
  { category: "Base", italian: "Arrivederci", uzbek: "Xayr", uzbekPronunciation: "khair", russian: "До свидания", russianPronunciation: "da svidània" },
  { category: "Base", italian: "Oggi / Domani", uzbek: "Bugun / Ertaga", uzbekPronunciation: "bugùn / ertagà", russian: "Сегодня / Завтра", russianPronunciation: "sivòdnia / zàftra" },
  { category: "Spostamenti", italian: "Dov’è…?", uzbek: "… qayerda?", uzbekPronunciation: "… qàierda", russian: "Где…?", russianPronunciation: "gdie" },
  { category: "Spostamenti", italian: "Dov’è il bagno?", uzbek: "Hojatxona qayerda?", uzbekPronunciation: "hojatkhòna qàierda", russian: "Где туалет?", russianPronunciation: "gdie tualèt" },
  { category: "Spostamenti", italian: "Dov’è la stazione?", uzbek: "Vokzal qayerda?", uzbekPronunciation: "vokzàl qàierda", russian: "Где вокзал?", russianPronunciation: "gdie vakzàl" },
  { category: "Spostamenti", italian: "Dov’è l’aeroporto?", uzbek: "Aeroport qayerda?", uzbekPronunciation: "aeroport qàierda", russian: "Где аэропорт?", russianPronunciation: "gdie aerapòrt" },
  { category: "Spostamenti", italian: "Portatemi qui, per favore", uzbek: "Iltimos, shu yerga olib boring", uzbekPronunciation: "iltimòs, shu iergà olib boring", russian: "Отвезите меня сюда, пожалуйста", russianPronunciation: "atvizìte minyà siudà, pajàlusta" },
  { category: "Spostamenti", italian: "A che ora?", uzbek: "Soat nechada?", uzbekPronunciation: "soàt nechadà", russian: "Во сколько?", russianPronunciation: "va skòlka" },
  { category: "Cibo", italian: "Acqua, per favore", uzbek: "Suv, iltimos", uzbekPronunciation: "suv, iltimòs", russian: "Воду, пожалуйста", russianPronunciation: "vòdu, pajàlusta" },
  { category: "Cibo", italian: "Tè, per favore", uzbek: "Choy, iltimos", uzbekPronunciation: "ciòi, iltimòs", russian: "Чай, пожалуйста", russianPronunciation: "ciài, pajàlusta" },
  { category: "Cibo", italian: "Il conto, per favore", uzbek: "Hisob, iltimos", uzbekPronunciation: "hisòb, iltimòs", russian: "Счёт, пожалуйста", russianPronunciation: "sciòt, pajàlusta" },
  { category: "Cibo", italian: "Avete piatti senza carne?", uzbek: "Go‘shtsiz taom bormi?", uzbekPronunciation: "goshtsìz taòm bòrmi", russian: "Есть блюдо без мяса?", russianPronunciation: "iest bliùda bez miàsa" },
  { category: "Cibo", italian: "Non piccante, per favore", uzbek: "Achchiq bo‘lmasin, iltimos", uzbekPronunciation: "acciq bolmasìn, iltimòs", russian: "Не острое, пожалуйста", russianPronunciation: "ni òstraye, pajàlusta" },
  { category: "Cibo", italian: "È molto buono!", uzbek: "Juda mazali!", uzbekPronunciation: "giudà mazalì", russian: "Очень вкусно!", russianPronunciation: "òcen vkùsna" },
  { category: "Acquisti", italian: "Quanto costa?", uzbek: "Bu qancha turadi?", uzbekPronunciation: "bu qància turadì", russian: "Сколько это стоит?", russianPronunciation: "skòlka eta stòit" },
  { category: "Acquisti", italian: "Posso pagare con la carta?", uzbek: "Karta bilan to‘lasam bo‘ladimi?", uzbekPronunciation: "kàrta bilàn tolasàm boladìmi", russian: "Можно оплатить картой?", russianPronunciation: "mòjna aplatìt kàrtoi" },
  { category: "Acquisti", italian: "È troppo caro", uzbek: "Juda qimmat", uzbekPronunciation: "giudà qimmàt", russian: "Слишком дорого", russianPronunciation: "slìshkam dòroga" },
  { category: "Acquisti", italian: "Uno / Due / Tre", uzbek: "Bir / Ikki / Uch", uzbekPronunciation: "bir / ikkì / uc", russian: "Один / Два / Три", russianPronunciation: "adìn / dva / tri" },
  { category: "Emergenze", italian: "Aiuto!", uzbek: "Yordam bering!", uzbekPronunciation: "yòrdam bering", russian: "Помогите!", russianPronunciation: "pamagìte" },
  { category: "Emergenze", italian: "Ho bisogno di un medico", uzbek: "Menga shifokor kerak", uzbekPronunciation: "mengà shifokòr keràk", russian: "Мне нужен врач", russianPronunciation: "mnie nùjen vrac" },
  { category: "Emergenze", italian: "Chiamate un’ambulanza", uzbek: "Tez yordam chaqiring", uzbekPronunciation: "tez yòrdam ciakirìng", russian: "Вызовите скорую помощь", russianPronunciation: "vìzavite skòruyu pòmosc" },
  { category: "Emergenze", italian: "Ho un’allergia", uzbek: "Menda allergiya bor", uzbekPronunciation: "mendà allergìya bor", russian: "У меня аллергия", russianPronunciation: "u minyà allergìya" },
  { category: "Emergenze", italian: "Mi sono perso/a", uzbek: "Men adashib qoldim", uzbekPronunciation: "men adashìb qoldìm", russian: "Я заблудился / заблудилась", russianPronunciation: "ya zabludìlsia / zabludìlas" },
  { category: "Emergenze", italian: "Chiamate la polizia", uzbek: "Politsiyani chaqiring", uzbekPronunciation: "politsìyani ciakirìng", russian: "Вызовите полицию", russianPronunciation: "vìzavite polìtsiyu" }
];

export default function Phrasebook() {
  const [category, setCategory] = useState<Category | "Tutte">("Tutte");
  const [query, setQuery] = useState("");

  const visiblePhrases = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("it");
    return phrases.filter((phrase) => {
      const matchesCategory = category === "Tutte" || phrase.category === category;
      const searchable = `${phrase.italian} ${phrase.uzbek} ${phrase.russian}`.toLocaleLowerCase("it");
      return matchesCategory && (!normalizedQuery || searchable.includes(normalizedQuery));
    });
  }, [category, query]);

  return (
    <section className="phrasebookPage">
      <header className="phrasebookHero">
        <span><Languages size={28}/></span>
        <div><small>UZBEKO · RUSSO</small><h2>Frasario da viaggio</h2><p>Le parole giuste per salutare, ordinare, spostarsi e chiedere aiuto.</p></div>
      </header>

      <div className="phrasebookTools">
        <label><Search size={17}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cerca una frase…" aria-label="Cerca nel frasario"/></label>
        <div className="phraseCategories" aria-label="Categorie del frasario">
          <button className={category === "Tutte" ? "active" : ""} onClick={() => setCategory("Tutte")}>Tutte</button>
          {categories.map(({ name, icon: Icon }) => (
            <button key={name} className={category === name ? "active" : ""} onClick={() => setCategory(name)}><Icon size={14}/>{name}</button>
          ))}
        </div>
      </div>

      <div className="languageNote">
        <strong>Uzbeko</strong> è la lingua ufficiale. <strong>Russo</strong> è molto diffuso nelle città, negli hotel e nei servizi turistici.
        La pronuncia riportata è una guida semplificata per italiani.
      </div>

      <div className="phraseList">
        {visiblePhrases.map((phrase) => (
          <article key={`${phrase.category}-${phrase.italian}`}>
            <span className="phraseCategory">{phrase.category}</span>
            <h3>{phrase.italian}</h3>
            <div className="phraseTranslations">
              <div><small>UZBEKO</small><strong lang="uz">{phrase.uzbek}</strong><em>{phrase.uzbekPronunciation}</em></div>
              <div><small>RUSSO</small><strong lang="ru">{phrase.russian}</strong><em>{phrase.russianPronunciation}</em></div>
            </div>
          </article>
        ))}
      </div>

      {visiblePhrases.length === 0 && <p className="phraseEmpty">Nessuna frase trovata. Prova con un’altra parola.</p>}
      <p className="phrasebookFooter"><ShieldAlert size={15}/> In emergenza usa anche i numeri 112, 102 (polizia) e 103 (ambulanza) presenti in “Info utili”.</p>
    </section>
  );
}
