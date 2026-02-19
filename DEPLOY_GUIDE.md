# 🚀 Instrukcja Wdrożenia w Chmurze (24/7)

Twoja aplikacja jest teraz gotowa do działania na serwerze! Poniżej znajdziesz kroki, jak uruchomić ją za darmo na platformie **Render**.

## Krok 1: Wgraj kod na GitHub
1. Załóż konto na [GitHub](https://github.com).
2. Stwórz nowe repozytorium (np. `vinted-analyzer`).
3. Wgraj wszystkie pliki z tego folderu do repozytorium.

## Krok 2: Wdrożenie na Render
1. Zaloguj się na [Render.com](https://render.com).
2. Kliknij **New +** -> **Web Service**.
3. Połącz swoje konto GitHub i wybierz repozytorium `vinted-analyzer`.
4. Render automatycznie wykryje `Dockerfile` i zacznie budować obraz.

## Krok 3: Konfiguracja (Bardzo Ważne!)
Aby analizator mógł działać w Twoim imieniu, musisz podać mu swoje ciasteczko sesji:
1. W ustawieniach Render (zakładka **Environment**) dodaj nową zmienną:
   - Key: `VINTED_COOKIE`
   - Value: (Tu wklej całe ciasteczko z przeglądarki - tak samo jak robiłeś to w aplikacji)
2. Kliknij **Save Changes**.

## Co to zmienia?
1. **Działanie 24/7**: Możesz wyłączyć komputer, a serwer będzie nadal aktywny.
2. **Monitorowanie w tle**: Co 30 minut serwer sam sprawdzi Twoje "Ulubione" i jeśli znajdzie okazje, zapisze to w swoich logach (możesz je podglądać na stronie Render w zakładce **Logs**).
3. **Dostęp Mobilny**: Twoja aplikacja będzie teraz dostępna pod adresem `https://twoja-nazwa.onrender.com` - możesz z niej korzystać na telefonie!

---
*Jeśli potrzebujesz pomocy z wyciągnięciem ciasteczka lub wgraniem na GitHub - daj znać!*
