/**
 * Pool of fictional character names drawn from books, movies, games, and pop
 * culture. Used as a cosmetic alias for each running agent session so the UI
 * reads "Frodo is working on ..." instead of "Agent 2 is working on ...".
 *
 * Names are session-scoped: assigned at first sighting of a sessionId and
 * kept stable until the session ends. No persistence across reloads — a
 * fresh page load rerolls the names. That's fine since they're purely
 * decorative.
 */

export const AGENT_NAMES: readonly string[] = [
  // Lord of the Rings
  "Frodo", "Samwise", "Aragorn", "Legolas", "Gimli", "Boromir", "Gandalf",
  "Galadriel", "Eowyn", "Faramir", "Pippin", "Merry", "Bilbo", "Arwen",
  "Saruman",
  // Star Wars
  "Luke", "Leia", "Han", "Yoda", "Obi-Wan", "Chewbacca", "Lando", "Rey",
  "Finn", "Poe", "Mando", "Grogu", "Ahsoka", "Padme", "Boba",
  // Harry Potter
  "Harry", "Hermione", "Ron", "Dumbledore", "McGonagall", "Snape", "Hagrid",
  "Sirius", "Lupin", "Neville", "Luna", "Ginny", "Draco", "Tonks", "Moody",
  // Marvel
  "Peter", "Tony", "Steve", "Thor", "Natasha", "Wanda", "Loki", "Groot",
  "Rocket", "Gamora", "T'Challa", "Strange",
  // DC
  "Kal-El", "Diana", "Zatanna", "Raven", "Starfire", "Harleen", "Constantine",
  // Game of Thrones
  "Arya", "Jon", "Tyrion", "Daenerys", "Cersei", "Sansa", "Bran", "Jaime",
  "Ned", "Brienne",
  // Zelda
  "Link", "Zelda", "Ganon", "Midna", "Ravio", "Impa",
  // Mario
  "Mario", "Luigi", "Peach", "Bowser", "Daisy",
  // Pokemon
  "Ash", "Misty", "Brock", "Gary", "Oak",
  // Final Fantasy
  "Cloud", "Tifa", "Aerith", "Sephiroth", "Squall", "Tidus", "Yuna", "Vaan",
  // Dune
  "Paul", "Chani", "Leto", "Jessica", "Gurney", "Duncan",
  // Matrix
  "Neo", "Trinity", "Morpheus", "Oracle", "Cypher",
  // Alien
  "Ripley", "Hicks", "Bishop",
  // Discworld
  "Rincewind", "Vimes", "Granny", "Vetinari", "Nobby",
  // Hitchhiker's Guide
  "Arthur", "Ford", "Zaphod", "Marvin",
  // Sherlock Holmes
  "Sherlock", "Watson", "Moriarty",
  // Princess Bride
  "Westley", "Buttercup", "Inigo", "Fezzik",
  // Studio Ghibli
  "Totoro", "Chihiro", "Sophie", "Howl", "Kiki", "Ashitaka",
  // Witcher
  "Geralt", "Yennefer", "Ciri", "Triss", "Dandelion",
  // Mass Effect
  "Shepard", "Garrus", "Liara", "Tali", "Wrex",
  // Halo
  "Chief", "Cortana", "Arbiter",
  // Portal
  "Chell", "GLaDOS",
  // Futurama
  "Fry", "Leela", "Bender", "Zoidberg", "Farnsworth",
  // Simpsons
  "Homer", "Bart", "Lisa", "Marge", "Moe",
  // Pixar / Disney
  "Wall-E", "Buzz", "Woody", "Nemo", "Mulan", "Ariel", "Simba", "Jasmine",
  "Moana", "Elsa",
  // Breaking Bad / various movies
  "Indiana", "Maximus", "Forrest", "Rick", "Morty", "Walter", "Heisenberg",
  "Marty", "Doc",
  // Anime / shonen
  "Naruto", "Sasuke", "Goku", "Vegeta", "Luffy",
  // Stranger Things
  "Eleven", "Mike", "Dustin", "Lucas", "Will",
  // Avatar: The Last Airbender
  "Aang", "Katara", "Sokka", "Toph",
  // The Office (fictional incarnations)
  "Dwight", "Jim", "Pam",
  // Firefly
  "Mal", "Zoe", "Jayne", "Wash", "River",
  // Buffy
  "Buffy", "Willow", "Xander", "Spike",
  // Doctor Who
  "Rose", "Clara", "Amy",
];

/**
 * Pick a random name from the pool, optionally excluding names already in
 * use (e.g. other live sessions) so no two concurrent agents share a name.
 * Falls back to the full pool if every name is taken.
 */
export function pickAgentName(exclude: ReadonlySet<string> = new Set()): string {
  const pool = AGENT_NAMES.filter((n) => !exclude.has(n));
  const source = pool.length > 0 ? pool : AGENT_NAMES;
  return source[Math.floor(Math.random() * source.length)];
}
