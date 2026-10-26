const APP = 'Mi Colección';
const VERSION = '2.25.0';
const DB_NAME = 'mi-coleccion-db';
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

function error(message, status = 400, extra = {}) {
  return json({ ok: false, error: message, ...extra }, status);
}

function cleanText(value, max = 10000) {
  if (value === null || value === undefined) return '';
  return String(value).slice(0, max);
}

function normalizeMatchText(value) {
  return cleanText(value, 4000).normalize('NFKC').trim().toLowerCase();
}

function canonicalizeMatchType(value) {
  const t = normalizeMatchText(value);
  if (t === 'vinilo' || t === 'vinilos') return 'Vinilos';
  if (t === 'cd' || t === 'cds') return 'CDs';
  if (t === 'pelicula' || t === 'películas' || t === 'peliculas') return 'Películas';
  if (t === 'videojuego' || t === 'videojuegos') return 'Videojuegos';
  if (t === 'libro' || t === 'libros') return 'Libros';
  if (t === 'otros') return 'Otros';
  return cleanText(value, 200).trim();
}

function baseMatchKeyForItem(item) {
  return [
    canonicalizeMatchType(item.type),
    normalizeMatchText(item.title),
    normalizeMatchText(item.author),
    cleanText(item.year, 200).trim(),
    normalizeMatchText(item.format),
    normalizeMatchText(item.subcategory),
    normalizeMatchText(item.genre)
  ].join('|');
}

function locationMatchKeyForItem(item) {
  return [
    baseMatchKeyForItem(item),
    `loc:${normalizeMatchText(item.location)}`,
    `pub:${normalizeMatchText(item.publisher)}`,
    `notes:${normalizeMatchText(item.notes)}`
  ].join('|');
}

function incomingMatchKeyForItem(item, presence) {
  return [
    baseMatchKeyForItem(item),
    presence.location ? `loc:${normalizeMatchText(item.location)}` : 'loc:*',
    presence.publisher ? `pub:${normalizeMatchText(item.publisher)}` : 'pub:*',
    presence.notes ? `notes:${normalizeMatchText(item.notes)}` : 'notes:*'
  ].join('|');
}

function normalizeItem(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('El elemento debe ser un objeto JSON');
  }
  const id = cleanText(body.id, 26).trim().toUpperCase();
  if (!ULID_RE.test(id)) throw new Error('ULID no válido');
  if (Number(body.schemaVersion) !== 2) throw new Error('schemaVersion debe ser 2');

  const images = Array.isArray(body.images) ? body.images : [];
  return {
    id,
    schemaVersion: 2,
    legacyId: body.legacyId == null ? null : cleanText(body.legacyId, 500),
    legacyKey: body.legacyKey == null ? null : cleanText(body.legacyKey, 4000),
    title: cleanText(body.title, 2000),
    type: cleanText(body.type, 200),
    subcategory: cleanText(body.subcategory, 1000),
    author: cleanText(body.author, 2000),
    format: cleanText(body.format, 1000),
    genre: cleanText(body.genre, 1000),
    year: cleanText(body.year, 200),
    notes: cleanText(body.notes, 20000),
    moreInfo: cleanText(body.moreInfo, 20000),
    publisher: cleanText(body.publisher, 2000),
    isbn: cleanText(body.isbn, 500),
    location: cleanText(body.location, 2000),
    authorGivenName: cleanText(body.authorGivenName, 1000),
    authorSurname1: cleanText(body.authorSurname1, 1000),
    authorSurname2: cleanText(body.authorSurname2, 1000),
    authorSort: cleanText(body.authorSort, 2200),
    images
  };
}

function rowToItem(row) {
  let images = [];
  try { images = JSON.parse(row.images_json || '[]'); } catch {}
  return {
    id: row.id,
    schemaVersion: row.schema_version,
    legacyId: row.legacy_id,
    legacyKey: row.legacy_key,
    title: row.title || '',
    type: row.type || '',
    subcategory: row.subcategory || '',
    author: row.author || '',
    format: row.format || '',
    genre: row.genre || '',
    year: row.year || '',
    notes: row.notes || '',
    moreInfo: row.more_info || '',
    publisher: row.publisher || '',
    isbn: row.isbn || '',
    location: row.location || '',
    authorGivenName: row.author_given_name || '',
    authorSurname1: row.author_surname_1 || '',
    authorSurname2: row.author_surname_2 || '',
    authorSort: row.author_sort || '',
    images,
    coverImage: coverUrlFromImages(row.id, images, row.updated_at),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}


const BOOK_AUTHOR_MIGRATION_V212 = [{"title":"La vida en rojo: una bigrafía del Che Guevara","isbn":"84-204-8522-5","location":"Box 1","given":"Jorge G.","surname1":"Castañeda","surname2":"","sort":"Castañeda, Jorge G."},{"title":"Alma roja, sangre azul","isbn":"978-84-15706-15-1","location":"Box 1","given":"Alejandro","surname1":"Cao","surname2":"De Benós","sort":"Cao De Benós, Alejandro"},{"title":"Trillo: historia y crónica de la Villa y su balneario","isbn":"978-84-44407-92-9","location":"Box 1","given":"Tomás","surname1":"Gismera","surname2":"Velasco","sort":"Gismera Velasco, Tomás"},{"title":"Los dragones del edén","isbn":"84-473-0224-5","location":"Box 1","given":"Carl","surname1":"Sagan","surname2":"","sort":"Sagan, Carl"},{"title":"Proverbios y cantares","isbn":"84-89669-63-5","location":"Box 1","given":"Antonio","surname1":"Machado","surname2":"","sort":"Machado, Antonio"},{"title":"Phrasal Verbs Plus","isbn":"978-1-4050-6390-6","location":"Box 1","given":"VV.AA.","surname1":"","surname2":"","sort":"VV.AA."},{"title":"Yo fui el último emperador de china","isbn":"84-217-8213-4","location":"Box 1","given":"Pu","surname1":"Yi","surname2":"","sort":"Yi, Pu"},{"title":"Antología de poetas españolas: de la generación del 27 al siglo XV","isbn":"978-84-9065-386-9","location":"Box 1","given":"VV.AA.","surname1":"","surname2":"","sort":"VV.AA."},{"title":"Convence y vencerás","isbn":"978-84-16253-78-4","location":"Box 1","given":"Antonio","surname1":"Fabregat","surname2":"","sort":"Fabregat, Antonio"},{"title":"Los grandes genios del arte: Velázquez","isbn":"84-89780-54-4","location":"Box 1","given":"VV.AA.","surname1":"","surname2":"","sort":"VV.AA."},{"title":"Mrs. Caldwell habla con su hijo","isbn":"84-345-8268-4","location":"Box 1","given":"Camilo José","surname1":"Cela","surname2":"","sort":"Cela, Camilo José"},{"title":"Factotum","isbn":"84-339-2005-7","location":"Box 1","given":"Charles","surname1":"Bukowski","surname2":"","sort":"Bukowski, Charles"},{"title":"Poesía de amor","isbn":"84-397-0202-7","location":"Box 1","given":"Pablo","surname1":"Neruda","surname2":"","sort":"Neruda, Pablo"},{"title":"Antología Poética","isbn":"84-345-8263-5","location":"Box 1","given":"Antonio","surname1":"Machado","surname2":"","sort":"Machado, Antonio"},{"title":"Las peregrinaciones de Childe Harold/ El corsario","isbn":"No tiene","location":"Box 1","given":"Lord","surname1":"Byron","surname2":"","sort":"Byron, Lord"},{"title":"Artículos escogidos","isbn":"No tiene","location":"Box 1","given":"Mariano José","surname1":"De Larra","surname2":"","sort":"De Larra, Mariano José"},{"title":"Leyendas y narraciones","isbn":"No tiene","location":"Box 1","given":"Gustavo Adolfo","surname1":"Bécquer","surname2":"","sort":"Bécquer, Gustavo Adolfo"},{"title":"Almacén de antigüedades","isbn":"No tiene","location":"Box 1","given":"Charles","surname1":"Dickens","surname2":"","sort":"Dickens, Charles"},{"title":"Eugenia Grandet","isbn":"No tiene","location":"Box 1","given":"Honorato","surname1":"De Balzac","surname2":"","sort":"De Balzac, Honorato"},{"title":"1984","isbn":"978-84-9989-094-4","location":"Box 1","given":"George","surname1":"Orwell","surname2":"","sort":"Orwell, George"},{"title":"El extranjero","isbn":"","location":"Box 2","given":"Albert","surname1":"Camus","surname2":"","sort":"Camus, Albert"},{"title":"Los elegidos","isbn":"","location":"Box 2","given":"Charly","surname1":"Efe","surname2":"","sort":"Efe, Charly"},{"title":"La familia de Pascual Duarte","isbn":"","location":"Box 2","given":"Camilo José","surname1":"Cela","surname2":"","sort":"Cela, Camilo José"},{"title":"Novelas ejemplares","isbn":"","location":"Box 2","given":"Miguel","surname1":"De Cervantes","surname2":"","sort":"De Cervantes, Miguel"},{"title":"Alguien voló sobre el nido del cuco","isbn":"","location":"Box 2","given":"Ken","surname1":"Kesey","surname2":"","sort":"Kesey, Ken"},{"title":"Odas de Ricardo Reis","isbn":"","location":"Box 2","given":"Fernando","surname1":"Pessoa","surname2":"","sort":"Pessoa, Fernando"},{"title":"Principios elementales y principios fundamentales de la filosofía","isbn":"","location":"Box 2","given":"Georges","surname1":"Politzer","surname2":"","sort":"Politzer, Georges"},{"title":"Materialismo y empiriocriticismo","isbn":"","location":"Box 2","given":"V.I.","surname1":"Lenin","surname2":"","sort":"Lenin, V.I."},{"title":"El viaje al poder de la mente","isbn":"","location":"Box 2","given":"Eduardo","surname1":"Punset","surname2":"","sort":"Punset, Eduardo"},{"title":"La arboleda perdida","isbn":"","location":"Box 2","given":"Rafael","surname1":"Alberti","surname2":"","sort":"Alberti, Rafael"},{"title":"De guerra y paz, de lucha y libertad","isbn":"","location":"Box 2","given":"VV.AA.","surname1":"","surname2":"","sort":"VV.AA."},{"title":"Los Sueños","isbn":"","location":"Box 2","given":"Francisco","surname1":"De Quevedo","surname2":"","sort":"De Quevedo, Francisco"},{"title":"El camino de las lágrimas","isbn":"","location":"Box 2","given":"Jorge","surname1":"Bucay","surname2":"","sort":"Bucay, Jorge"},{"title":"Debussy","isbn":"","location":"Box 2","given":"Georges","surname1":"Gourdet","surname2":"","sort":"Gourdet, Georges"},{"title":"¿Quién se ha llevado mi queso?","isbn":"","location":"Box 2","given":"Spencer","surname1":"Johnson","surname2":"","sort":"Johnson, Spencer"},{"title":"La vida es sueño","isbn":"","location":"Box 2","given":"Calderón","surname1":"De La Barca","surname2":"","sort":"De La Barca, Calderón"},{"title":"Cómo ganar amigos e influir sobre las personas","isbn":"","location":"Box 2","given":"Dale","surname1":"Carnegie","surname2":"","sort":"Carnegie, Dale"},{"title":"Fábulas","isbn":"978-84-675-3607-2","location":"Box 3","given":"Jean","surname1":"De La Fontaine","surname2":"","sort":"De La Fontaine, Jean"},{"title":"España en los grandes músicos","isbn":"978-84-17308-81-0","location":"Box 3","given":"Andrés","surname1":"Ruiz","surname2":"Tarazona","sort":"Ruiz Tarazona, Andrés"},{"title":"Los amores mparables","isbn":"978-84-08-18264-1","location":"Box 3","given":"Marwan","surname1":"","surname2":"","sort":"Marwan"},{"title":"Altísimo: un viaje con Fernando Romay","isbn":"978-84-95157-67-6","location":"Box 3","given":"Jacobo","surname1":"Rivero","surname2":"","sort":"Rivero, Jacobo"},{"title":"1001 discos que hay que escuchar antes de morir","isbn":"978-84-16220-73-1","location":"Box 3","given":"Robert","surname1":"Dimery","surname2":"","sort":"Dimery, Robert"},{"title":"El viajante en Beijing","isbn":"84-01-35121-9","location":"Box 3","given":"Arthur","surname1":"Miller","surname2":"","sort":"Miller, Arthur"},{"title":"La voz y el actor","isbn":"978-84-8428-310-2","location":"Box 3","given":"Cicely","surname1":"Berry","surname2":"","sort":"Berry, Cicely"},{"title":"Stalin","isbn":"84-7140-122-3","location":"Box 3","given":"Rose","surname1":"Tremain","surname2":"","sort":"Tremain, Rose"},{"title":"Cuentos de la mitología griega I","isbn":"84-7960-300-3","location":"Box 3","given":"Alicia / Mercedes","surname1":"Esteban / Aguirre","surname2":"","sort":"Esteban / Aguirre, Alicia / Mercedes"},{"title":"El profeta","isbn":"0-375-70162-","location":"Box 3","given":"Kahlil","surname1":"Gibran","surname2":"","sort":"Gibran, Kahlil"},{"title":"Las reglas del método sociológico","isbn":"84-7530-933-X","location":"Box 3","given":"Émile","surname1":"Durkheim","surname2":"","sort":"Durkheim, Émile"},{"title":"Economía humanista","isbn":"978-84-9908-178-6","location":"Box 3","given":"José Luis","surname1":"Sampedro","surname2":"","sort":"Sampedro, José Luis"},{"title":"Las almas de Brandon","isbn":"978-84-670-5244-2","location":"Box 3","given":"César","surname1":"Brandon","surname2":"Ndjocu","sort":"Brandon Ndjocu, César"},{"title":"Reforma o Revolución","isbn":"978-84-932118-1-3","location":"Box 3","given":"Rosa","surname1":"Luxemburgo","surname2":"","sort":"Luxemburgo, Rosa"},{"title":"Raros, radicales, rebeldes: microbiografías ilustradas","isbn":"978-84-947814-2-1","location":"Box 3","given":"Carlos","surname1":"Cubeiro","surname2":"","sort":"Cubeiro, Carlos"},{"title":"Los renglones torcidos de Dios","isbn":"84-08-02550-3","location":"Box 3","given":"Torcuato","surname1":"Luca","surname2":"De Tena","sort":"Luca De Tena, Torcuato"},{"title":"San Manuel bueno, mártir, y tres historias más","isbn":"84-239-0254-4","location":"Box 3","given":"Miguel","surname1":"De Unamuno","surname2":"","sort":"De Unamuno, Miguel"},{"title":"Maravillas del mundo: Tesoros culturales","isbn":"978-84-9939-369-8","location":"Box 3","given":"VV.AA.","surname1":"","surname2":"","sort":"VV.AA."},{"title":"Las almas de Brandon","isbn":"978-84-670-5244-2","location":"Box 3","given":"César","surname1":"Brandon","surname2":"Ndjocu","sort":"Brandon Ndjocu, César"},{"title":"Trópico de Carpicornio","isbn":"84-8130-127-2","location":"Box 4","given":"Herny","surname1":"Miller","surname2":"","sort":"Miller, Herny"},{"title":"Nicolás Maquiavelo: la sonrisa de Maquiavelo","isbn":"No tiene","location":"Box 4","given":"Maurizio","surname1":"Viroli","surname2":"","sort":"Viroli, Maurizio"},{"title":"Las figuras retóricas en el rap español del s. XXI","isbn":"978-84-16824-20-5","location":"Box 4","given":"Alberto","surname1":"Buscató","surname2":"Vázquez","sort":"Buscató Vázquez, Alberto"},{"title":"Los jefes","isbn":"84-8130-002-0","location":"Box 4","given":"Mario","surname1":"Vargas","surname2":"Llosa","sort":"Vargas Llosa, Mario"},{"title":"El tonto está lleno de mundos","isbn":"No tiene","location":"Box 4","given":"Santiuve","surname1":"","surname2":"","sort":"Santiuve"},{"title":"Enciclopedia de la Música: Clásica, ópera y ballet","isbn":"84-7927-386-0","location":"Box 4","given":"Henry","surname1":"Lindemann","surname2":"","sort":"Lindemann, Henry"},{"title":"Viaje a la Alcarria","isbn":"84-322-2052-3","location":"Box 4","given":"Camilo José","surname1":"Cela","surname2":"","sort":"Cela, Camilo José"},{"title":"A solas con la mar","isbn":"84-226-7559-5","location":"Box 4","given":"J.J.","surname1":"Benítez","surname2":"","sort":"Benítez, J.J."},{"title":"Lecturas presocráticas","isbn":"84-85708-12-1","location":"Box 4","given":"Agustín","surname1":"García","surname2":"Calvo","sort":"García Calvo, Agustín"},{"title":"Ébano","isbn":"84-413-1966-9","location":"Box 4","given":"Ryszard","surname1":"Kapuscinski","surname2":"","sort":"Kapuscinski, Ryszard"},{"title":"La gaviota","isbn":"84-8130-171-X","location":"Box 4","given":"Antón P.","surname1":"Chéjov","surname2":"","sort":"Chéjov, Antón P."},{"title":"Don Álvaro y la fuerza del sino","isbn":"84-9815-042-6","location":"Box 4","given":"Duqe","surname1":"De Rivas","surname2":"","sort":"De Rivas, Duqe"},{"title":"Ataúdes de artesanía","isbn":"84-8130-023-3","location":"Box 4","given":"Truman","surname1":"Capote","surname2":"","sort":"Capote, Truman"},{"title":"El sonido en los medios audiovisuales","isbn":"978-84-935769-6-7","location":"Box 4","given":"Stanley R.","surname1":"Alten","surname2":"","sort":"Alten, Stanley R."},{"title":"Ejército popular y militares de la república (1936-1939)","isbn":"84-320-4288-9","location":"Box 4","given":"Cristóbal","surname1":"Zaragoza","surname2":"","sort":"Zaragoza, Cristóbal"},{"title":"Steven Spielberg: biografía no autorizada","isbn":"84-413-2086-1","location":"Box 4","given":"John","surname1":"Baxter","surname2":"","sort":"Baxter, John"},{"title":"Poesía","isbn":"84-376-0061-8","location":"Box 4","given":"Jorge","surname1":"Manrique","surname2":"","sort":"Manrique, Jorge"},{"title":"El profeta","isbn":"No tiene","location":"Box 4","given":"Khalil","surname1":"Gibran","surname2":"","sort":"Gibran, Khalil"},{"title":"Réquiem por un campesino español","isbn":"84-75303-483-4","location":"Box 4","given":"Ramón J.","surname1":"Sender","surname2":"","sort":"Sender, Ramón J."},{"title":"Curiosidades y anécdotas de Madrid","isbn":"978-84-87290-53-4","location":"Box 4","given":"Mª Isabel","surname1":"Gea","surname2":"Ortigas","sort":"Gea Ortigas, Mª Isabel"},{"title":"Curiosidades y anécdotas de Madrid: 2ª parte","isbn":"84-87290-94-9","location":"Box 4","given":"Mª Isabel","surname1":"Gea","surname2":"Ortigas","sort":"Gea Ortigas, Mª Isabel"},{"title":"Velázquez, el pintor hidalgo","isbn":"No tiene","location":"Box 4","given":"VV.AA.","surname1":"","surname2":"","sort":"VV.AA."},{"title":"Música y Sociedad: Análisis sociológico de la cultura musical de la posmodernidad","isbn":"978-84-8048-756-6","location":"Box 5","given":"Jaime","surname1":"Hormigos","surname2":"Ruiz","sort":"Hormigos Ruiz, Jaime"},{"title":"Dilla Time: The Life and Afterlife","isbn":"978-03-7413-994-0","location":"Box 5","given":"Dan","surname1":"Charnas","surname2":"","sort":"Charnas, Dan"},{"title":"Antología Poética","isbn":"84-607-0067-4","location":"Box 5","given":"Luis Felipe","surname1":"Batanero","surname2":"Ochaíta","sort":"Batanero Ochaíta, Luis Felipe"},{"title":"Escucha: Una historia del oído melómano","isbn":"84-493-1482-8","location":"Box 5","given":"Peter","surname1":"Szendy","surname2":"","sort":"Szendy, Peter"},{"title":"Curso urgente de política para gente decente","isbn":"978-84-322-2081-4","location":"Box 5","given":"Juan Carlos","surname1":"Monedero","surname2":"","sort":"Monedero, Juan Carlos"},{"title":"Hábitos Atómicos","isbn":"978-84-18118-03-6","location":"Box 5","given":"James","surname1":"Clear","surname2":"","sort":"Clear, James"},{"title":"El Sueño de mis desvelo","isbn":"978-84-15242-23-9","location":"Box 5","given":"Antoni","surname1":"Daimiel","surname2":"","sort":"Daimiel, Antoni"},{"title":"El capitán salió a comer y los marineros tomaron el barco","isbn":"84-339-2383-8","location":"Box 5","given":"Charles","surname1":"Bukowski","surname2":"","sort":"Bukowski, Charles"},{"title":"Taylor Swift: La era de la generación Swiftie","isbn":"978-84-19875-56-3","location":"Box 5","given":"Patricia C.","surname1":"Agüero","surname2":"","sort":"Agüero, Patricia C."},{"title":"Miles Davis y Kind of Blue: La creación de una obra maestra","isbn":"978-84-8428-637-0","location":"Box 5","given":"Ashley","surname1":"Kahn","surname2":"","sort":"Kahn, Ashley"},{"title":"Una invitación a la lectura","isbn":"84-89669-61-9","location":"Box 5","given":"VV.AA.","surname1":"","surname2":"","sort":"VV.AA."},{"title":"Veinte poemas de amor y una canción desesperada / Los versos del capitán","isbn":"84-89669-21-X","location":"Box 5","given":"Pablo","surname1":"Neruda","surname2":"","sort":"Neruda, Pablo"},{"title":"El ruido y la furia","isbn":"84-89669-38-4","location":"Box 5","given":"William","surname1":"Faulkner","surname2":"","sort":"Faulkner, William"},{"title":"La náusea","isbn":"84-89669-47-3","location":"Box 5","given":"Jean-Paul","surname1":"Sartre","surname2":"","sort":"Sartre, Jean-Paul"},{"title":"Marinero en tierra","isbn":"84-89669-48-1","location":"Box 5","given":"Rafael","surname1":"Alberti","surname2":"","sort":"Alberti, Rafael"},{"title":"Trillo: Patrimonio Histórico Artístico","isbn":"","location":"Box 5","given":"Ayuntamiento","surname1":"De Trillo","surname2":"","sort":"De Trillo, Ayuntamiento"},{"title":"El cupón falso y Jadzhi Murat","isbn":"978-84-936213-5-3","location":"Box 6","given":"Lev","surname1":"Tólstoi","surname2":"","sort":"Tólstoi, Lev"},{"title":"Búnker: Memorias de encierro, rimas y tiburones blancos","isbn":"978-84-17552-81-7","location":"Box 6","given":"Toteking","surname1":"","surname2":"","sort":"Toteking"},{"title":"Yonqui","isbn":"84-339-2368-4","location":"Box 6","given":"William","surname1":"S. Burroughs","surname2":"","sort":"S. Burroughs, William"},{"title":"Fedón","isbn":"978-84-249-2814-8","location":"Box 6","given":"Platón","surname1":"","surname2":"","sort":"Platón"},{"title":"Antología breve de la literatura contemporánea rusa","isbn":"No tiene","location":"Box 6","given":"VV.AA.","surname1":"","surname2":"","sort":"VV.AA."},{"title":"1799-1999: Nuestro Pushkin","isbn":"5-88407-066-7","location":"Box 6","given":"Alexander","surname1":"Pushkin","surname2":"","sort":"Pushkin, Alexander"},{"title":"Diario de Guantánamo","isbn":"978-84-945043-1-0","location":"Box 6","given":"Mohamedou","surname1":"Ould","surname2":"Slahi","sort":"Ould Slahi, Mohamedou"},{"title":"El barón rampante","isbn":"84-89669-49-X","location":"Box 6","given":"Italo","surname1":"Calvino","surname2":"","sort":"Calvino, Italo"},{"title":"El tiempo que fingimos","isbn":"978-84-123607-9-0","location":"Box 6","given":"Cat","surname1":"Yuste","surname2":"","sort":"Yuste, Cat"},{"title":"Los árboles solitarios: una hermenéutica del amor y los árboles","isbn":"978-84-943423-3-2","location":"Box 6","given":"Alejandro","surname1":"Tarantino","surname2":"","sort":"Tarantino, Alejandro"},{"title":"Poesía medieval","isbn":"84-9815-032-9","location":"Box 6","given":"Jorge","surname1":"Manrique","surname2":"","sort":"Manrique, Jorge"},{"title":"Obra poética","isbn":"84-9815-034-5","location":"Box 6","given":"Rosalía","surname1":"De Castro","surname2":"","sort":"De Castro, Rosalía"},{"title":"¡Indignaos!","isbn":"978-84-233-4471-0","location":"Box 6","given":"Stéphane","surname1":"Hessel","surname2":"","sort":"Hessel, Stéphane"},{"title":"Confieso que he vivido / Memorias","isbn":"84-322-0268-1","location":"Box 6","given":"Pablo","surname1":"Neruda","surname2":"","sort":"Neruda, Pablo"},{"title":"Cinco horas con Mario","isbn":"978-84-233-4240-2","location":"Box 6","given":"Miguel","surname1":"Delibes","surname2":"","sort":"Delibes, Miguel"},{"title":"El Buscón","isbn":"84-7969-010-0","location":"Box 6","given":"Francisco","surname1":"De Quevedo","surname2":"","sort":"De Quevedo, Francisco"},{"title":"Memorias del subsuelo","isbn":"84-376-2032-5","location":"Box 6","given":"Fiódor M","surname1":"Dostoievski","surname2":"","sort":"Dostoievski, Fiódor M"},{"title":"El viejo y el mar","isbn":"970637144-3","location":"Box 6","given":"Ernest","surname1":"Hemingway","surname2":"","sort":"Hemingway, Ernest"},{"title":"Poesía","isbn":"970637116-8","location":"Box 6","given":"Miguel","surname1":"Hernández","surname2":"","sort":"Hernández, Miguel"},{"title":"Curiosidades de la historia: los hechos curiosos de a hisoria comentados con ironía","isbn":"84-7672-364-4","location":"Box 6","given":"Martin","surname1":"Walker","surname2":"","sort":"Walker, Martin"},{"title":"El guardián entre el centeno","isbn":"978-84-206-7420-9","location":"Box 6","given":"J.D.","surname1":"Salinger","surname2":"","sort":"Salinger, J.D."},{"title":"La condición humana","isbn":"84-320-2184-9","location":"Box 6","given":"André","surname1":"Malraux","surname2":"","sort":"Malraux, André"},{"title":"Leonardo Da Vinci","isbn":"3-8228-4903-0","location":"Box 7","given":"Frank","surname1":"Zöllner","surname2":"","sort":"Zöllner, Frank"},{"title":"Zozobras Completas","isbn":"978-84-617-5763-3","location":"Box 7","given":"Javier","surname1":"Krahe","surname2":"","sort":"Krahe, Javier"},{"title":"Poemas/ Ensayos/ Canciones/ Diarios/ Entrevistas","isbn":"978-84-339-5959-1","location":"Box 7","given":"Allen","surname1":"Ginsberg","surname2":"","sort":"Ginsberg, Allen"},{"title":"The Dharma beats","isbn":"978-84-946342-8.4","location":"Box 7","given":"VV.AA.","surname1":"","surname2":"","sort":"VV.AA."},{"title":"Canciones de amor y droga","isbn":"978-84-949821-2-5","location":"Box 7","given":"Charly","surname1":"Efe","surname2":"","sort":"Efe, Charly"},{"title":"Cómo escuchar jazz","isbn":"978-84-16714-13-1","location":"Box 7","given":"Ted","surname1":"Gioia","surname2":"","sort":"Gioia, Ted"},{"title":"Cuentos de metro","isbn":"978-17-90932-82-5","location":"Box 7","given":"Cat","surname1":"Yuste","surname2":"","sort":"Yuste, Cat"},{"title":"Mi utopía vivida","isbn":"978-84-15313-99-1","location":"Box 7","given":"Lucio","surname1":"Urtubia","surname2":"","sort":"Urtubia, Lucio"},{"title":"Maribel y la extraña familia","isbn":"978-84-376-2223-1","location":"Box 7","given":"Miguel","surname1":"Mihura","surname2":"","sort":"Mihura, Miguel"},{"title":"Bestiario","isbn":"84-473-0202-4","location":"Box 7","given":"Julio","surname1":"Cortázar","surname2":"","sort":"Cortázar, Julio"},{"title":"Let It Be (Déjalo estar)","isbn":"No tiene","location":"Box 7","given":"José María","surname1":"Campillo","surname2":"De Miguel","sort":"Campillo De Miguel, José María"},{"title":"Los años eléctricos","isbn":"No tiene","location":"Box 7","given":"Charly","surname1":"Efe","surname2":"","sort":"Efe, Charly"},{"title":"Oliver Twist","isbn":"0-9-423092-9","location":"Box 7","given":"Charles","surname1":"Dickens","surname2":"","sort":"Dickens, Charles"},{"title":"Los placeres del condenado","isbn":"978-84-9895-796-9","location":"Box 7","given":"Charles","surname1":"Bukowski","surname2":"","sort":"Bukowski, Charles"},{"title":"Ruiseñor, deséame suerte","isbn":"978-84-9895-857-7","location":"Box 7","given":"Charles","surname1":"Bukowski","surname2":"","sort":"Bukowski, Charles"},{"title":"Las cenizas de Gramsci","isbn":"978-84-9895-732-7","location":"Box 7","given":"Pier Paolo","surname1":"Pasolini","surname2":"","sort":"Pasolini, Pier Paolo"},{"title":"El alquimista y otros relatos","isbn":"No tiene","location":"Box 7","given":"H.P.","surname1":"Lovecraft","surname2":"","sort":"Lovecraft, H.P."},{"title":"20 poemas de amor y una canción desesperada","isbn":"968-15-0108-X","location":"Box 7","given":"Pablo","surname1":"Neruda","surname2":"","sort":"Neruda, Pablo"},{"title":"En el camino","isbn":"84-02-07680-7","location":"Box 7","given":"Jack","surname1":"Kerouac","surname2":"","sort":"Kerouac, Jack"},{"title":"No de nunca","isbn":"No tiene","location":"Box 7","given":"Charly","surname1":"Efe","surname2":"","sort":"Efe, Charly"},{"title":"La tregua","isbn":"84-376-0148-7","location":"Box 7","given":"Mario","surname1":"Benedetti","surname2":"","sort":"Benedetti, Mario"},{"title":"Anna Karenina","isbn":"978-84-206-7844-3","location":"Box 8","given":"Lev","surname1":"Tólstoi","surname2":"","sort":"Tólstoi, Lev"},{"title":"Anecdotakes","isbn":"978-84-9140-889-5","location":"Box 8","given":"Salvador","surname1":"Aldeguer","surname2":"","sort":"Aldeguer, Salvador"},{"title":"Tirano Banderas","isbn":"84-226-3258-6","location":"Box 8","given":"Ramón María","surname1":"Del Valle","surname2":"Inclán","sort":"Del Valle Inclán, Ramón María"},{"title":"Fariña","isbn":"978-84-16001-46-0","location":"Box 8","given":"Nacho","surname1":"Carretero","surname2":"","sort":"Carretero, Nacho"},{"title":"Garbajosa: el líder silencioso","isbn":"978-84-95157-71-3","location":"Box 8","given":"José Joaquín","surname1":"Brotons","surname2":"","sort":"Brotons, José Joaquín"},{"title":"Los grandes genios del arte: Goya","isbn":"84-89780-55-2","location":"Box 8","given":"VV.AA.","surname1":"","surname2":"","sort":"VV.AA."},{"title":"Eternamente","isbn":"978-84-03-51845-2","location":"Box 8","given":"Pablo","surname1":"López","surname2":"Rueda","sort":"López Rueda, Pablo"},{"title":"Esto no es un cuento","isbn":"84-206-9274-3","location":"Box 8","given":"Denis","surname1":"Diderot","surname2":"","sort":"Diderot, Denis"},{"title":"Phladelphia","isbn":"84-402-1806-0","location":"Box 8","given":"Christopher","surname1":"Davis","surname2":"","sort":"Davis, Christopher"},{"title":"Feminismo para principiantes","isbn":"978-84-9872-873-6","location":"Box 8","given":"Nuria","surname1":"Varela","surname2":"","sort":"Varela, Nuria"},{"title":"No vine a ser carne","isbn":"978-84-03-52214-5","location":"Box 8","given":"Gata","surname1":"Cattana","surname2":"","sort":"Cattana, Gata"},{"title":"La escala de Mohs","isbn":"978-84-03-51955-8","location":"Box 8","given":"Gata","surname1":"Cattana","surname2":"","sort":"Cattana, Gata"},{"title":"Let It Be (Déjalo estar)","isbn":"No tiene","location":"Box 8","given":"José María","surname1":"Campillo","surname2":"De Miguel","sort":"Campillo De Miguel, José María"},{"title":"El pensamiento lateral","isbn":"84-493-0590-X","location":"Box 8","given":"Edward","surname1":"De Bono","surname2":"","sort":"De Bono, Edward"},{"title":"Algo alrededor de tu cuello","isbn":"978-84-397-3296-9","location":"Box 8","given":"Chimamanda","surname1":"Ngozi","surname2":"Adichie","sort":"Ngozi Adichie, Chimamanda"},{"title":"Qué bien me haces cuando me haces bien","isbn":"978-84-253-6332-0","location":"Box 8","given":"Albert","surname1":"Espinosa","surname2":"","sort":"Espinosa, Albert"},{"title":"La sombra del ciprés es alargada","isbn":"84-8130-250-3","location":"Box 8","given":"Miguel","surname1":"Delibes","surname2":"","sort":"Delibes, Miguel"},{"title":"La mística de la feminidad","isbn":"978-84-376-3604-7","location":"Box 9","given":"Betty","surname1":"Friedan","surname2":"","sort":"Friedan, Betty"},{"title":"Simone de Beauvoir: Del sexo al género","isbn":"No tiene","location":"Box 9","given":"Cristina","surname1":"Sánchez","surname2":"Muñoz","sort":"Sánchez Muñoz, Cristina"},{"title":"Estaba preparado para todo menos para ti","isbn":"978-84-253-6050-3","location":"Box 9","given":"Albert","surname1":"Espinosa","surname2":"","sort":"Espinosa, Albert"},{"title":"Idiotizadas","isbn":"978-84-08-17688-6","location":"Box 9","given":"Moderna","surname1":"De Pueblo","surname2":"","sort":"De Pueblo, Moderna"},{"title":"Coñodramas","isbn":"978-84-08-23345-9","location":"Box 9","given":"Moderna","surname1":"De Pueblo","surname2":"","sort":"De Pueblo, Moderna"},{"title":"La chica miedosa que fingía ser valiente muy mal","isbn":"978-84-03-50232-1","location":"Box 9","given":"Barbijaputa","surname1":"","surname2":"","sort":"Barbijaputa"},{"title":"Una habitación propia","isbn":"978-84-322-1964-1","location":"Box 9","given":"Virginia","surname1":"Woolf","surname2":"","sort":"Woolf, Virginia"},{"title":"Los amores imparables","isbn":"978-84-08-18264-1","location":"Box 9","given":"Marwan","surname1":"","surname2":"","sort":"Marwan"},{"title":"Todos mis futuros son contigo","isbn":"978-84-08-14103-7","location":"Box 9","given":"Marwan","surname1":"","surname2":"","sort":"Marwan"},{"title":"Mírate","isbn":"978-84-03-51587-1","location":"Box 9","given":"Andrea","surname1":"Villalonga","surname2":"","sort":"Villalonga, Andrea"},{"title":"Machismo","isbn":"978-84-16700-49-3","location":"Box 9","given":"Barbijaputa","surname1":"","surname2":"","sort":"Barbijaputa"},{"title":"Mujeres que ya no sufren por amor: transformndo el mito romántico","isbn":"978-84-9097-462-9","location":"Box 9","given":"Coral","surname1":"Herrera","surname2":"","sort":"Herrera, Coral"},{"title":"Mujeres difíiciles","isbn":"978-84-9181-428-3","location":"Box 9","given":"Roxane","surname1":"Gay","surname2":"","sort":"Gay, Roxane"},{"title":"Los hombres me explican cosas","isbn":"978-84-945481-4-7","location":"Box 9","given":"Rebeca","surname1":"Solnit","surname2":"","sort":"Solnit, Rebeca"},{"title":"Las feministas queremos","isbn":"978-84-948603-0-0","location":"Box 9","given":"Isabel","surname1":"Mastrodoménico","surname2":"","sort":"Mastrodoménico, Isabel"},{"title":"El diario de los incurables","isbn":"978-84-09-43101-4","location":"Box 9","given":"Guiu","surname1":"Cortés","surname2":"","sort":"Cortés, Guiu"},{"title":"Los años eléctricos","isbn":"No tiene","location":"Box 9","given":"Charly","surname1":"Efe","surname2":"","sort":"Efe, Charly"},{"title":"Relatos de mujer: X - XI -XII","isbn":"No tiene","location":"Box 9","given":"Emakumeak","surname1":"Kontari","surname2":"","sort":"Kontari, Emakumeak"},{"title":"Investigación de mercados: obtención de información","isbn":"84-470-1312-X","location":"Box 10","given":"Angel","surname1":"Fernández","surname2":"Nogales","sort":"Fernández Nogales, Angel"},{"title":"Morder la manzana","isbn":"978-84-08-18262-7","location":"Box 10","given":"Leticia","surname1":"Dolera","surname2":"","sort":"Dolera, Leticia"},{"title":"Las mujeres que no amaban a los hombres","isbn":"978-84-92924-05-9","location":"Box 10","given":"Diego","surname1":"De Los Santos","surname2":"","sort":"De Los Santos, Diego"},{"title":"El despertar de los musas","isbn":"978-84-08-21553-0","location":"Box 10","given":"Beatriz","surname1":"Luengo","surname2":"","sort":"Luengo, Beatriz"},{"title":"Leonas y zorras","isbn":"978-84-9097-440-7","location":"Box 10","given":"Clara","surname1":"Serra","surname2":"","sort":"Serra, Clara"},{"title":"Todo lo que necesito existe ya en mí","isbn":"978-84-322-3772-0","location":"Box 10","given":"Rupi","surname1":"Kaur","surname2":"","sort":"Kaur, Rupi"},{"title":"Get Back (Regresa)","isbn":"No tiene","location":"Box 10","given":"José María","surname1":"Campillo","surname2":"De Miguel","sort":"Campillo De Miguel, José María"},{"title":"Vigo es Vivaldi","isbn":"84-216-3961-7","location":"Box 10","given":"José Ramón","surname1":"Ayllón","surname2":"","sort":"Ayllón, José Ramón"},{"title":"Diario de Paula","isbn":"978-84-216-9191-5","location":"Box 10","given":"José Ramón","surname1":"Ayllón","surname2":"","sort":"Ayllón, José Ramón"},{"title":"La mujer en la política: el largo camino hacia la igualdad","isbn":"84-01-37679-3","location":"Box 10","given":"Pilar","surname1":"Cernuda","surname2":"","sort":"Cernuda, Pilar"},{"title":"La triste historia de tu cuerpo sobre el mío","isbn":"978-84-616-3274-9","location":"Box 10","given":"Marwan","surname1":"","surname2":"","sort":"Marwan"},{"title":"Rimas y Leyendas","isbn":"978-84-9105-033-9","location":"Box 10","given":"Gustavo Adolfo","surname1":"Bécquer","surname2":"","sort":"Bécquer, Gustavo Adolfo"},{"title":"Teoría King Kong","isbn":"978-84-397-3385-0","location":"Box 10","given":"Virgin","surname1":"Despentes","surname2":"","sort":"Despentes, Virgin"},{"title":"Marina","isbn":"978-84-236-8726-8","location":"Box 10","given":"Carlos","surname1":"Ruiz","surname2":"Zafón","sort":"Ruiz Zafón, Carlos"},{"title":"El príncipe de la niebla","isbn":"978-84-08-07280-5","location":"Box 10","given":"Carlos","surname1":"Ruiz","surname2":"Zafón","sort":"Ruiz Zafón, Carlos"},{"title":"El sentimiento negativo","isbn":"978-84-670-3635-0","location":"Box 10","given":"Risto","surname1":"Mejide","surname2":"","sort":"Mejide, Risto"},{"title":"Cuarenta y tres maneras de soltarse el pelo","isbn":"978-84-15786-29-0","location":"Box 10","given":"Elvira","surname1":"Sastre","surname2":"","sort":"Sastre, Elvira"},{"title":"La ridícula idea de no voler a verte","isbn":"978-84-322-2271-9","location":"Box 10","given":"Rosa","surname1":"Montero","surname2":"","sort":"Montero, Rosa"},{"title":"La mujer de al lado","isbn":"978-84-09-03822-0","location":"Box 10","given":"Jessica","surname1":"Gómez","surname2":"Álvarez","sort":"Gómez Álvarez, Jessica"},{"title":"Casi sin querer","isbn":"978-84-943989-0-2","location":"Box 10","given":"Defreds","surname1":"","surname2":"","sort":"Defreds"},{"title":"20 poemas de amor y una canción desesperada","isbn":"978-980-7716-04-8","location":"Box 10","given":"Pablo","surname1":"Neruda","surname2":"","sort":"Neruda, Pablo"},{"title":"Todos deberíamos ser feministas","isbn":"978-84-397-3048-4","location":"Box 10","given":"Chimamanda","surname1":"Ngozi","surname2":"Adichie","sort":"Ngozi Adichie, Chimamanda"},{"title":"Investigación de mercados","isbn":"84-481-0738-1","location":"Box 10","given":"VV.AA.","surname1":"","surname2":"","sort":"VV.AA."},{"title":"Estadística aplicada básica","isbn":"84-85855-80-9","location":"Box 10","given":"David S.","surname1":"Moore","surname2":"","sort":"Moore, David S."},{"title":"Azañón: Historia y crónica","isbn":"9798766322429","location":"Box 16","given":"Tomás","surname1":"Gismera","surname2":"De Velasco","sort":"Gismera De Velasco, Tomás"},{"title":"En defensa de la intolerancia","isbn":"No tiene","location":"Box 16","given":"Slavok","surname1":"Zizek","surname2":"","sort":"Zizek, Slavok"},{"title":"La metamorfosis/ La condena/ La muralla china","isbn":"978-84-414-2166-0","location":"Box 16","given":"Franz","surname1":"Kafka","surname2":"","sort":"Kafka, Franz"},{"title":"Rinconete y cottadillo","isbn":"84-207-2632-X","location":"Box 16","given":"Miguel","surname1":"De Cervantes","surname2":"","sort":"De Cervantes, Miguel"},{"title":"La terribilitá: la luz nada testimonia","isbn":"978-84-16794-95-9","location":"Box 16","given":"Alejandro","surname1":"Tarantino","surname2":"Aréchega","sort":"Tarantino Aréchega, Alejandro"},{"title":"Escupiré sobre vuestra tumba","isbn":"84-96075-29-X","location":"Box 16","given":"Boris","surname1":"Vian","surname2":"","sort":"Vian, Boris"},{"title":"Cuentos morales","isbn":"84-206-9252-2","location":"Box 16","given":"Leopoldo","surname1":"Alas","surname2":"Clarín","sort":"Alas Clarín, Leopoldo"},{"title":"Luces de Bohemia","isbn":"84-239-1307-4","location":"Box 16","given":"Ramón María","surname1":"Del Valle","surname2":"Inclán","sort":"Del Valle Inclán, Ramón María"},{"title":"Fragmentos de un cuaderno manchado de vino","isbn":"978-84-339-7705-2","location":"Box 16","given":"Charles","surname1":"Bukowski","surname2":"","sort":"Bukowski, Charles"},{"title":"Antología Poética","isbn":"84-265-7187-5","location":"Box 16","given":"Antonio","surname1":"Machado","surname2":"","sort":"Machado, Antonio"},{"title":"Desde mi celda","isbn":"84-404-4235-1","location":"Box 16","given":"Gustavo Adolfo","surname1":"Bécquer","surname2":"","sort":"Bécquer, Gustavo Adolfo"},{"title":"Antología de lo poesía culterana","isbn":"84-334-3030-0","location":"Box 16","given":"Ángel","surname1":"Pariente","surname2":"","sort":"Pariente, Ángel"},{"title":"Mein Kampf","isbn":"84-365-1823-3","location":"Box 16","given":"Adolf","surname1":"Hitler","surname2":"","sort":"Hitler, Adolf"},{"title":"Ukelele para principiantes","isbn":"978-84-480-2454-3","location":"Box 16","given":"Will","surname1":"Grove-White","surname2":"","sort":"Grove-White, Will"},{"title":"Escuela Tchokov de piano: Iniciación","isbn":"978-84-936575-9-8","location":"Box 16","given":"","surname1":"Tchokov-Gemiu","surname2":"","sort":"Tchokov-Gemiu"},{"title":"Los poetas malditos","isbn":"","location":"Box 16","given":"Paul Von","surname1":"Verlaine","surname2":"","sort":"Verlaine, Paul Von"},{"title":"Método intuitivo para piano","isbn":"978-84-16574-38-4","location":"Box 16","given":"Gorka","surname1":"Pastor","surname2":"","sort":"Pastor, Gorka"},{"title":"12 notas: sobre la vida y la creatividad","isbn":"978-84-18417-38-2","location":"Box 16","given":"Quincy","surname1":"Jones","surname2":"","sort":"Jones, Quincy"},{"title":"Sonetos","isbn":"84-402-2176-2","location":"Box 23","given":"William","surname1":"Shakespeare","surname2":"","sort":"Shakespeare, William"},{"title":"La perfecta casada","isbn":"No tiene","location":"Box 23","given":"Fray Luis","surname1":"De León","surname2":"","sort":"De León, Fray Luis"},{"title":"Los hermano Karamazov","isbn":"No tiene","location":"Box 23","given":"Fiódor","surname1":"Dostoievski","surname2":"","sort":"Dostoievski, Fiódor"},{"title":"Antología Poética I","isbn":"84-473-2100-2","location":"Box 23","given":"Juan Ramón","surname1":"Jiménez","surname2":"","sort":"Jiménez, Juan Ramón"},{"title":"Poesías selectas: 1924-1934","isbn":"84-473-2112-6","location":"Box 23","given":"Rafael","surname1":"Alberti","surname2":"","sort":"Alberti, Rafael"},{"title":"El tartufo / El enfermo imaginario","isbn":"84-7461-209-8","location":"Box 23","given":"","surname1":"Moliére","surname2":"","sort":"Moliére"},{"title":"Santuario","isbn":"84-7530-088-X","location":"Box 23","given":"William","surname1":"Faulkner","surname2":"","sort":"Faulkner, William"},{"title":"Las flores del mal","isbn":"No tiene","location":"Box 23","given":"Charles","surname1":"Baudelaire","surname2":"","sort":"Baudelaire, Charles"},{"title":"Don Quijote de La Mancha (I)","isbn":"84-473-0307-1","location":"Box 23","given":"Miguel","surname1":"De Cervantes","surname2":"Saavedra","sort":"De Cervantes Saavedra, Miguel"},{"title":"Poesías selectas","isbn":"84-473-2122-3","location":"Box 23","given":"Charles","surname1":"Baudelaire","surname2":"","sort":"Baudelaire, Charles"},{"title":"Poesías completas","isbn":"84-473-2111-8","location":"Box 23","given":"Rubén","surname1":"Darío","surname2":"","sort":"Darío, Rubén"},{"title":"La vuelta al mundo en 80 días","isbn":"84-473-2629-2","location":"Box 23","given":"Julio","surname1":"Verne","surname2":"","sort":"Verne, Julio"},{"title":"Grandes biografías:Wolfgang Amadeus Mozart","isbn":"84-87507-28-X","location":"Box 24","given":"VV.AA.","surname1":"","surname2":"","sort":"VV.AA."},{"title":"La materia oscura","isbn":"978-84-473-8197-5","location":"Box 24","given":"Alberto","surname1":"Casas","surname2":"","sort":"Casas, Alberto"},{"title":"La sonrisa etrusca","isbn":"84-473-0122-2","location":"Box 24","given":"José Luis","surname1":"Sampedro","surname2":"","sort":"Sampedro, José Luis"},{"title":"Music, the brain and ecstasy: how music captueres our imagination","isbn":"978-0-380-78209-3","location":"Box 24","given":"Robert","surname1":"Jourdain","surname2":"","sort":"Jourdain, Robert"},{"title":"La realidad y el deseo","isbn":"84-473-2114-2","location":"Box 25","given":"Luis","surname1":"Cernuda","surname2":"","sort":"Cernuda, Luis"},{"title":"Poemas satíricos","isbn":"No tiene","location":"Box 25","given":"Francisco","surname1":"De Quevedo","surname2":"","sort":"De Quevedo, Francisco"},{"title":"La muerte en Venecia","isbn":"84-322-2176-7","location":"Box 25","given":"Thomas","surname1":"Mann","surname2":"","sort":"Mann, Thomas"},{"title":"El túnel","isbn":"84-322-2325-5","location":"Box 25","given":"Ernesto","surname1":"Sábato","surname2":"","sort":"Sábato, Ernesto"},{"title":"Ceremonias","isbn":"84-322-2324-7","location":"Box 25","given":"Julio","surname1":"Cortázar","surname2":"","sort":"Cortázar, Julio"},{"title":"Antología Poética","isbn":"84-7530-387-0","location":"Box 25","given":"Lope","surname1":"De Vega","surname2":"","sort":"De Vega, Lope"},{"title":"PremioNobel de Literatura 1910","isbn":"84-7461-152-0","location":"Box 25","given":"Paul Von","surname1":"Heyse","surname2":"","sort":"Heyse, Paul Von"},{"title":"Tiempos difíciles","isbn":"84-7530-0323-4","location":"Box 25","given":"Charles","surname1":"Dickens","surname2":"","sort":"Dickens, Charles"},{"title":"Macbeth / Otelo / El mercader / Julio César","isbn":"84-225-0438-3","location":"Box 25","given":"William","surname1":"Shakespeare","surname2":"","sort":"Shakespeare, William"},{"title":"Trillo: Paseos por la naturaleza. Guía del viajero","isbn":"","location":"Dentro del libro del ukelele","given":"VV.AA.","surname1":"","surname2":"","sort":"VV.AA."},{"title":"33 1/3: My Beautiful Dark Twisted Fatasy","isbn":"978-1-62356-542-8","location":"Tocadiscos","given":"Kirk","surname1":"Walker","surname2":"Graves","sort":"Walker Graves, Kirk"},{"title":"33 1/3: Illmatic","isbn":"978-0-8264-2907-0","location":"Tocadiscos","given":"Matthew","surname1":"Gasteier","surname2":"","sort":"Gasteier, Matthew"},{"title":"33 1/3: Madvillainy","isbn":"978-1-5013-8923-8","location":"Tocadiscos","given":"Will","surname1":"Hagle","surname2":"","sort":"Hagle, Will"},{"title":"33 1/3: Let It Be","isbn":"978-0-8264-1634-6","location":"Tocadiscos","given":"Steve","surname1":"Matteo","surname2":"","sort":"Matteo, Steve"},{"title":"33 1/3: Donuts","isbn":"978-1-62365-183-3","location":"Tocadiscos","given":"Jordan","surname1":"Ferguson","surname2":"","sort":"Ferguson, Jordan"},{"title":"El libro del filósofo","isbn":"978-84-306-0221-6","location":"Tocadiscos","given":"Friedrich","surname1":"Nietzsche","surname2":"","sort":"Nietzsche, Friedrich"},{"title":"El libro de la música clásica","isbn":"978-84-460-4770-4","location":"","given":"VV.AA.","surname1":"","surname2":"","sort":"VV.AA."}];

async function ensureAuthorStructureMigration(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS app_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `).run();

  const migrationName = 'v2.21.2-book-author-structure';
  const done = await db.prepare(`SELECT name FROM app_migrations WHERE name = ?`).bind(migrationName).first();
  if (done) return;

  const countRow = await db.prepare(`SELECT COUNT(*) AS n FROM items WHERE type = 'Libros'`).first();
  if (!Number(countRow?.n || 0)) return;

  const statements = [];
  for (const meta of BOOK_AUTHOR_MIGRATION_V212) {
    statements.push(db.prepare(`
      UPDATE items SET
        author_given_name = ?,
        author_surname_1 = ?,
        author_surname_2 = ?,
        author_sort = ?
      WHERE type = 'Libros'
        AND title = ?
        AND isbn = ?
        AND location = ?
        AND (author_given_name = '' OR author_given_name IS NULL)
    `).bind(
      meta.given || '', meta.surname1 || '', meta.surname2 || '', meta.sort || '',
      meta.title || '', meta.isbn || '', meta.location || ''
    ));
  }

  for (let i = 0; i < statements.length; i += 50) {
    await db.batch(statements.slice(i, i + 50));
  }

  await db.prepare(`INSERT OR REPLACE INTO app_migrations(name, applied_at) VALUES (?, ?)`)
    .bind(migrationName, new Date().toISOString()).run();
}

async function ensureItemsTable(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      schema_version INTEGER NOT NULL DEFAULT 2 CHECK(schema_version = 2),
      legacy_id TEXT,
      legacy_key TEXT,
      title TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT '',
      subcategory TEXT NOT NULL DEFAULT '',
      author TEXT NOT NULL DEFAULT '',
      format TEXT NOT NULL DEFAULT '',
      genre TEXT NOT NULL DEFAULT '',
      year TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      more_info TEXT NOT NULL DEFAULT '',
      publisher TEXT NOT NULL DEFAULT '',
      isbn TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      author_given_name TEXT NOT NULL DEFAULT '',
      author_surname_1 TEXT NOT NULL DEFAULT '',
      author_surname_2 TEXT NOT NULL DEFAULT '',
      author_sort TEXT NOT NULL DEFAULT '',
      images_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();

  // Migración aditiva para bases D1 creadas antes de v2.21.0.
  const { results: cols } = await db.prepare('PRAGMA table_info(items)').all();
  const names = new Set((cols || []).map(c => String(c.name)));
  if (!names.has('publisher')) await db.prepare(`ALTER TABLE items ADD COLUMN publisher TEXT NOT NULL DEFAULT ''`).run();
  if (!names.has('isbn')) await db.prepare(`ALTER TABLE items ADD COLUMN isbn TEXT NOT NULL DEFAULT ''`).run();
  if (!names.has('location')) await db.prepare(`ALTER TABLE items ADD COLUMN location TEXT NOT NULL DEFAULT ''`).run();
  if (!names.has('author_given_name')) await db.prepare(`ALTER TABLE items ADD COLUMN author_given_name TEXT NOT NULL DEFAULT ''`).run();
  if (!names.has('author_surname_1')) await db.prepare(`ALTER TABLE items ADD COLUMN author_surname_1 TEXT NOT NULL DEFAULT ''`).run();
  if (!names.has('author_surname_2')) await db.prepare(`ALTER TABLE items ADD COLUMN author_surname_2 TEXT NOT NULL DEFAULT ''`).run();
  if (!names.has('author_sort')) await db.prepare(`ALTER TABLE items ADD COLUMN author_sort TEXT NOT NULL DEFAULT ''`).run();

  await ensureAuthorStructureMigration(db);

  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_items_type ON items(type)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_items_legacy_key ON items(legacy_key)`).run();
}

function coverObjectKey(id) {
  return `covers/${id}/01.jpg`;
}

function coverUrlFromImages(id, images, fallbackVersion = '') {
  const cover = Array.isArray(images) ? images.find(img => img && img.role === 'cover' && img.key) : null;
  if (!cover) return null;
  const version = cover.updatedAt || fallbackVersion || '';
  return `/api/images/${encodeURIComponent(id)}/cover${version ? `?v=${encodeURIComponent(version)}` : ''}`;
}

async function imageApi(request, env, url) {
  if (!env.IMAGES) return error('Binding R2 IMAGES no disponible', 500, { r2: 'missing-binding' });
  await ensureItemsTable(env.DB);

  const match = url.pathname.match(/^\/api\/images\/([^/]+)\/cover$/);
  if (!match) return error('Ruta de imagen no válida', 404);

  const id = decodeURIComponent(match[1]).trim().toUpperCase();
  if (!ULID_RE.test(id)) return error('ULID no válido', 400);
  const key = coverObjectKey(id);

  if (request.method === 'GET') {
    const object = await env.IMAGES.get(key);
    if (!object) return error('Carátula no encontrada', 404);
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('Content-Type', headers.get('Content-Type') || 'image/jpeg');
    headers.set('Cache-Control', 'private, max-age=86400');
    if (object.httpEtag) headers.set('ETag', object.httpEtag);
    return new Response(object.body, { headers });
  }

  const row = await env.DB.prepare(`SELECT * FROM items WHERE id = ?`).bind(id).first();
  if (!row) return error('Elemento no encontrado', 404);

  if (request.method === 'PUT') {
    const contentType = String(request.headers.get('Content-Type') || '').toLowerCase();
    if (!contentType.startsWith('image/')) return error('El archivo debe ser una imagen', 415);

    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength) return error('La imagen está vacía', 400);
    if (bytes.byteLength > 1_000_000) return error('La imagen supera el límite de 1 MB', 413);

    const now = new Date().toISOString();
    await env.IMAGES.put(key, bytes, {
      httpMetadata: { contentType: 'image/jpeg' },
      customMetadata: { itemId: id, role: 'cover' }
    });

    let images = [];
    try { images = JSON.parse(row.images_json || '[]'); } catch {}
    images = (Array.isArray(images) ? images : []).filter(img => !(img && img.role === 'cover'));
    images.push({ key, role: 'cover', contentType: 'image/jpeg', updatedAt: now });

    await env.DB.prepare(`UPDATE items SET images_json = ?, updated_at = ? WHERE id = ?`)
      .bind(JSON.stringify(images), now, id).run();
    const updatedRow = await env.DB.prepare(`SELECT * FROM items WHERE id = ?`).bind(id).first();
    return json({ ok: true, uploaded: true, item: rowToItem(updatedRow) });
  }

  if (request.method === 'DELETE') {
    await env.IMAGES.delete(key);
    let images = [];
    try { images = JSON.parse(row.images_json || '[]'); } catch {}
    images = (Array.isArray(images) ? images : []).filter(img => !(img && img.role === 'cover'));
    const now = new Date().toISOString();
    await env.DB.prepare(`UPDATE items SET images_json = ?, updated_at = ? WHERE id = ?`)
      .bind(JSON.stringify(images), now, id).run();
    const updatedRow = await env.DB.prepare(`SELECT * FROM items WHERE id = ?`).bind(id).first();
    return json({ ok: true, deleted: true, item: rowToItem(updatedRow) });
  }

  return error('Método no permitido', 405);
}

async function r2SmokeTest(env) {
  if (!env.IMAGES) return error('Binding R2 IMAGES no disponible', 500, { r2: 'missing-binding' });

  const key = `_healthcheck/mi-coleccion-${crypto.randomUUID()}.txt`;
  const payload = `Mi Colección R2 smoke test ${new Date().toISOString()}`;
  let wrote = false;
  let read = false;
  let deleted = false;

  try {
    await env.IMAGES.put(key, payload, {
      httpMetadata: { contentType: 'text/plain; charset=utf-8' }
    });
    wrote = true;

    const object = await env.IMAGES.get(key);
    if (!object) throw new Error('R2 no devolvió el objeto recién escrito');
    const stored = await object.text();
    if (stored !== payload) throw new Error('El contenido leído de R2 no coincide con el escrito');
    read = true;

    await env.IMAGES.delete(key);
    deleted = true;

    return json({
      ok: true,
      app: APP,
      version: VERSION,
      r2: 'connected',
      bucket: 'mi-coleccion-images',
      write: wrote,
      read,
      delete: deleted,
      persistentTestObject: false
    });
  } catch (e) {
    if (wrote && !deleted) {
      try { await env.IMAGES.delete(key); deleted = true; } catch {}
    }
    return json({
      ok: false,
      app: APP,
      version: VERSION,
      r2: 'error',
      write: wrote,
      read,
      delete: deleted,
      error: String(e?.message || e)
    }, 500);
  }
}



const RESTORE_SESSION_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function restoreTempKey(sessionId, id) {
  return `_restore/${sessionId}/${id}.jpg`;
}

function validIsoOr(value, fallback) {
  if (!value) return fallback;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? fallback : d.toISOString();
}

async function listAllR2Keys(bucket, prefix) {
  const keys = [];
  let cursor;
  do {
    const page = await bucket.list({ prefix, cursor });
    for (const obj of page.objects || []) keys.push(obj.key);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return keys;
}

async function deleteR2Keys(bucket, keys) {
  for (let i = 0; i < keys.length; i += 100) {
    const chunk = keys.slice(i, i + 100);
    if (chunk.length) await bucket.delete(chunk);
  }
}

async function restoreApi(request, env, url) {
  if (!env.IMAGES) return error('Binding R2 IMAGES no disponible', 500);
  await ensureItemsTable(env.DB);

  const parts = url.pathname.split('/').filter(Boolean); // api, restore, session, ...
  if (parts.length < 3 || parts[0] !== 'api' || parts[1] !== 'restore') return error('Ruta de restauración no válida', 404);
  const sessionId = decodeURIComponent(parts[2] || '').trim();
  if (!RESTORE_SESSION_RE.test(sessionId)) return error('Sesión de restauración no válida', 400);

  if (request.method === 'POST' && parts.length === 4 && parts[3] === 'start') {
    let payload = {};
    try { payload = await request.json(); } catch {}
    const imageCount = Number(payload.imageCount || 0);
    if (!Number.isInteger(imageCount) || imageCount < 0 || imageCount > 1000) return error('Número de imágenes no válido', 400);
    // Limpiamos restos de una sesión con el mismo UUID, si existieran.
    const old = await listAllR2Keys(env.IMAGES, `_restore/${sessionId}/`);
    if (old.length) await deleteR2Keys(env.IMAGES, old);
    return json({ ok: true, sessionId, imageCount });
  }

  if (request.method === 'PUT' && parts.length === 5 && parts[3] === 'images') {
    const id = decodeURIComponent(parts[4] || '').trim().toUpperCase();
    if (!ULID_RE.test(id)) return error('ULID de imagen no válido', 400);
    const contentType = String(request.headers.get('Content-Type') || '').toLowerCase();
    if (!contentType.startsWith('image/')) return error('El archivo debe ser una imagen', 415);
    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength) return error('La imagen está vacía', 400);
    if (bytes.byteLength > 1_000_000) return error('La imagen supera el límite de 1 MB', 413);
    await env.IMAGES.put(restoreTempKey(sessionId, id), bytes, {
      httpMetadata: { contentType: 'image/jpeg' },
      customMetadata: { restoreSession: sessionId, itemId: id, role: 'cover' }
    });
    return json({ ok: true, staged: true, id });
  }

  if (request.method === 'DELETE' && parts.length === 3) {
    const temp = await listAllR2Keys(env.IMAGES, `_restore/${sessionId}/`);
    if (temp.length) await deleteR2Keys(env.IMAGES, temp);
    return json({ ok: true, cleaned: temp.length });
  }

  if (request.method === 'POST' && parts.length === 4 && parts[3] === 'commit') {
    let payload;
    try { payload = await request.json(); }
    catch { return error('JSON de restauración no válido', 400); }
    if (!payload || payload.backupType !== 'MiColeccion-full' || Number(payload.backupFormatVersion) !== 1) {
      return error('Formato de copia completa no compatible', 400);
    }
    if (!Array.isArray(payload.items) || payload.items.length === 0 || payload.items.length > 1000) {
      return error('Lista de elementos no válida', 400);
    }
    if (!Array.isArray(payload.images) || payload.images.length > 1000) return error('Manifiesto de imágenes no válido', 400);

    let incoming;
    try { incoming = payload.items.map(normalizeItem); }
    catch (e) { return error(e.message, 400); }
    const ids = incoming.map(x => x.id);
    if (new Set(ids).size !== ids.length) return error('El backup contiene ULID duplicados', 409);
    const idSet = new Set(ids);

    const imageById = new Map();
    for (const img of payload.images) {
      const id = cleanText(img?.id, 26).trim().toUpperCase();
      if (!ULID_RE.test(id) || !idSet.has(id)) return error('El manifiesto contiene una carátula inválida', 400);
      if (img?.role !== 'cover' || imageById.has(id)) return error('Manifiesto de carátulas no válido', 400);
      imageById.set(id, { contentType: 'image/jpeg' });
    }

    // Verificar que todos los objetos temporales existen ANTES de tocar D1.
    for (const id of imageById.keys()) {
      const staged = await env.IMAGES.head(restoreTempKey(sessionId, id));
      if (!staged) return error(`Falta la carátula temporal de ${id}`, 409);
    }

    // Copiar las imágenes temporales a sus claves definitivas antes del commit D1.
    // Si algo falla aquí, D1 permanece intacto.
    const imageIds = [...imageById.keys()];
    for (let i = 0; i < imageIds.length; i += 10) {
      const chunk = imageIds.slice(i, i + 10);
      await Promise.all(chunk.map(async id => {
        const staged = await env.IMAGES.get(restoreTempKey(sessionId, id));
        if (!staged) throw new Error(`Carátula temporal desaparecida: ${id}`);
        const bytes = await staged.arrayBuffer();
        await env.IMAGES.put(coverObjectKey(id), bytes, {
          httpMetadata: { contentType: 'image/jpeg' },
          customMetadata: { itemId: id, role: 'cover' }
        });
      }));
    }

    const now = new Date().toISOString();
    const originalsById = new Map(payload.items.map(it => [String(it.id || '').trim().toUpperCase(), it]));
    const statements = [env.DB.prepare('DELETE FROM items')];

    for (const item of incoming) {
      const original = originalsById.get(item.id) || {};
      const hasCover = imageById.has(item.id);
      let images = Array.isArray(item.images) ? item.images.filter(img => !(img && img.role === 'cover')) : [];
      if (hasCover) {
        const originalCover = Array.isArray(original.images) ? original.images.find(img => img && img.role === 'cover') : null;
        images.push({
          key: coverObjectKey(item.id),
          role: 'cover',
          contentType: 'image/jpeg',
          updatedAt: validIsoOr(originalCover?.updatedAt, validIsoOr(original.updatedAt, now))
        });
      }
      const createdAt = validIsoOr(original.createdAt, now);
      const updatedAt = validIsoOr(original.updatedAt, now);

      statements.push(env.DB.prepare(`
        INSERT INTO items (
          id, schema_version, legacy_id, legacy_key, title, type, subcategory,
          author, format, genre, year, notes, more_info, publisher, isbn, location, author_given_name, author_surname_1, author_surname_2, author_sort, images_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        item.id, item.schemaVersion, item.legacyId, item.legacyKey, item.title, item.type,
        item.subcategory, item.author, item.format, item.genre, item.year, item.notes,
        item.moreInfo, item.publisher, item.isbn, item.location, item.authorGivenName, item.authorSurname1, item.authorSurname2, item.authorSort, JSON.stringify(images), createdAt, updatedAt
      ));
    }

    // D1 batch es la unidad transaccional: si una sentencia falla, no queda una
    // colección parcialmente sustituida.
    await env.DB.batch(statements);

    // Limpiar carátulas antiguas que no pertenecen al backup restaurado.
    let imageCleanup = true;
    try {
      const wanted = new Set(imageIds.map(coverObjectKey));
      const currentCoverKeys = await listAllR2Keys(env.IMAGES, 'covers/');
      const stale = currentCoverKeys.filter(key => !wanted.has(key));
      if (stale.length) await deleteR2Keys(env.IMAGES, stale);
    } catch (e) {
      imageCleanup = false;
      console.error('[restore stale R2 cleanup]', e);
    }

    // Limpiar siempre la zona temporal de esta restauración.
    try {
      const temp = await listAllR2Keys(env.IMAGES, `_restore/${sessionId}/`);
      if (temp.length) await deleteR2Keys(env.IMAGES, temp);
    } catch (e) {
      console.error('[restore temp cleanup]', e);
    }

    const { results } = await env.DB.prepare('SELECT * FROM items ORDER BY type COLLATE NOCASE, title COLLATE NOCASE, id').all();
    return json({
      ok: true,
      restored: true,
      count: results.length,
      imageCount: imageIds.length,
      imageCleanup
    });
  }

  return error('Método de restauración no permitido', 405);
}


function importPresence(raw) {
  return {
    ulid: raw?._excelUlid === true,
    publisher: Object.prototype.hasOwnProperty.call(raw, 'publisher'),
    isbn: Object.prototype.hasOwnProperty.call(raw, 'isbn'),
    location: Object.prototype.hasOwnProperty.call(raw, 'location'),
    notes: Object.prototype.hasOwnProperty.call(raw, 'notes'),
    moreInfo: Object.prototype.hasOwnProperty.call(raw, 'moreInfo'),
    authorGivenName: Object.prototype.hasOwnProperty.call(raw, 'authorGivenName'),
    authorSurname1: Object.prototype.hasOwnProperty.call(raw, 'authorSurname1'),
    authorSurname2: Object.prototype.hasOwnProperty.call(raw, 'authorSurname2'),
    authorSort: Object.prototype.hasOwnProperty.call(raw, 'authorSort')
  };
}

function repairRowMatches(row, item, presence) {
  const same = (a, b) => normalizeMatchText(a) === normalizeMatchText(b);
  if (!same(row.type, item.type) || !same(row.title, item.title) || !same(row.subcategory, item.subcategory) ||
      !same(row.author, item.author) || cleanText(row.year, 200).trim() !== cleanText(item.year, 200).trim() ||
      !same(row.format, item.format) || !same(row.genre, item.genre)) return false;
  if (presence.publisher && !same(row.publisher, item.publisher)) return false;
  if (presence.isbn && !same(row.isbn, item.isbn)) return false;
  if (presence.location && !same(row.location, item.location)) return false;
  if (presence.notes && !same(row.notes, item.notes)) return false;
  if (presence.moreInfo && !same(row.more_info, item.moreInfo)) return false;
  return true;
}

function repairAnchorCandidates(existingRows, item, presence) {
  const same = (a, b) => normalizeMatchText(a) === normalizeMatchText(b);
  return (existingRows || []).filter(row => {
    if (!same(row.type, item.type) || !same(row.title, item.title) || !same(row.subcategory, item.subcategory) ||
        !same(row.author, item.author) || cleanText(row.year, 200).trim() !== cleanText(item.year, 200).trim()) return false;
    if (presence.location && !same(row.location, item.location)) return false;
    if (presence.publisher && !same(row.publisher, item.publisher)) return false;
    if (presence.notes && !same(row.notes, item.notes)) return false;
    if (presence.isbn && !same(row.isbn, item.isbn)) return false;
    return true;
  });
}

function olderRowFirst(a, b) {
  const ca = String(a.created_at || '');
  const cb = String(b.created_at || '');
  if (ca !== cb) return ca.localeCompare(cb);
  return String(a.id || '').localeCompare(String(b.id || ''));
}

async function buildRepairPlan(env, rawItems) {
  const incoming = rawItems.map(raw => ({ item: normalizeItem(raw), presence: importPresence(raw) }));
  const { results: existingRows } = await env.DB.prepare(`
    SELECT id, legacy_id, legacy_key, created_at, updated_at, images_json, publisher, isbn, location, notes, more_info,
           author_given_name, author_surname_1, author_surname_2, author_sort,
           title, type, subcategory, author, format, genre, year
    FROM items
  `).all();

  const actions = [];
  const examples = [];
  let duplicatePairs = 0;
  let singleMatches = 0;
  let ambiguous = 0;

  for (const { item, presence } of incoming) {
    const candidates = repairAnchorCandidates(existingRows || [], item, presence).sort(olderRowFirst);
    if (candidates.length === 1) {
      singleMatches++;
      actions.push({ kind: 'update', original: candidates[0], duplicate: null, item, presence });
      continue;
    }
    if (candidates.length === 2) {
      const exact = candidates.filter(row => repairRowMatches(row, item, presence));
      if (exact.length === 1) {
        const duplicate = exact[0];
        const original = candidates.find(row => row.id !== duplicate.id);
        // La copia creada por la importación debe ser la más reciente. Si no lo es,
        // consideramos el caso ambiguo y no borramos nada.
        const newest = [...candidates].sort(olderRowFirst)[1];
        if (original && newest.id === duplicate.id) {
          duplicatePairs++;
          actions.push({ kind: 'dedupe', original, duplicate, item, presence });
          if (examples.length < 6) examples.push(`${item.title} — conservar ${original.id.slice(-6)} / eliminar ${duplicate.id.slice(-6)}`);
          continue;
        }
      }
    }
    ambiguous++;
    if (examples.length < 6) examples.push(`${item.title} — ${candidates.length} coincidencias; no se tocará`);
  }

  return { incoming, existingRows: existingRows || [], actions, inputCount: incoming.length, duplicatePairs, singleMatches, ambiguous, examples };
}

async function reconcileImportApi(request, env) {
  let payload;
  try { payload = await request.json(); }
  catch { return error('JSON de reparación no válido', 400); }
  if (!payload || !Array.isArray(payload.items) || !payload.items.length) return error('No hay elementos que analizar', 400);
  if (payload.items.length > 1000) return error('Demasiados elementos', 400);
  if (payload.items.some(x => x?._excelUlid === true)) return error('La reparación temporal no admite Excel con ULID', 400);

  const plan = await buildRepairPlan(env, payload.items);
  if (payload.mode !== 'apply') {
    return json({ ok: true, mode: 'preview', inputCount: plan.inputCount, duplicatePairs: plan.duplicatePairs,
      singleMatches: plan.singleMatches, ambiguous: plan.ambiguous, examples: plan.examples });
  }
  if (plan.ambiguous) return error('Hay casos ambiguos. No se ha modificado nada.', 409, { ambiguous: plan.ambiguous, examples: plan.examples });
  if (!plan.duplicatePairs) return error('No se han detectado duplicados seguros para reparar.', 409);

  const now = new Date().toISOString();
  const statements = [];
  const duplicateIds = [];
  for (const action of plan.actions) {
    const { original, duplicate, item, presence } = action;
    const publisher = presence.publisher ? item.publisher : String(original.publisher || '');
    const isbn = presence.isbn ? item.isbn : String(original.isbn || '');
    const location = presence.location ? item.location : String(original.location || '');
    const notes = presence.notes ? item.notes : String(original.notes || '');
    const moreInfo = presence.moreInfo ? item.moreInfo : String(original.more_info || '');
    const authorGivenName = presence.authorGivenName ? item.authorGivenName : String(original.author_given_name || '');
    const authorSurname1 = presence.authorSurname1 ? item.authorSurname1 : String(original.author_surname_1 || '');
    const authorSurname2 = presence.authorSurname2 ? item.authorSurname2 : String(original.author_surname_2 || '');
    const authorSort = presence.authorSort ? item.authorSort : String(original.author_sort || '');
    const finalLegacyKey = locationMatchKeyForItem({ ...item, publisher, location, notes });
    const imagesJson = String(original.images_json || '[]');

    statements.push(env.DB.prepare(`
      UPDATE items SET
        schema_version=?, legacy_id=?, legacy_key=?, title=?, type=?, subcategory=?, author=?, format=?, genre=?, year=?,
        notes=?, more_info=?, publisher=?, isbn=?, location=?, author_given_name=?, author_surname_1=?, author_surname_2=?,
        author_sort=?, images_json=?, updated_at=? WHERE id=?
    `).bind(
      item.schemaVersion, original.legacy_id || item.legacyId, finalLegacyKey, item.title, item.type, item.subcategory,
      item.author, item.format, item.genre, item.year, notes, moreInfo, publisher, isbn, location,
      authorGivenName, authorSurname1, authorSurname2, authorSort, imagesJson, now, original.id
    ));

    if (duplicate) {
      statements.push(env.DB.prepare('DELETE FROM items WHERE id = ?').bind(duplicate.id));
      duplicateIds.push(duplicate.id);
    }
  }

  for (let i = 0; i < statements.length; i += 50) await env.DB.batch(statements.slice(i, i + 50));

  // Las copias importadas por Excel normalmente no tienen imágenes, pero limpiamos
  // cualquier objeto R2 asociado por seguridad.
  if (env.IMAGES) {
    for (const id of duplicateIds) {
      try {
        const keys = await listAllR2Keys(env.IMAGES, `covers/${id}/`);
        if (keys.length) await deleteR2Keys(env.IMAGES, keys);
      } catch (e) { console.error('[reconcile R2 cleanup]', id, e); }
    }
  }

  return json({ ok: true, mode: 'apply', reconciled: plan.actions.length, deletedDuplicates: duplicateIds.length,
    inputCount: plan.inputCount, ambiguous: 0 });
}

async function itemsApi(request, env, url) {
  await ensureItemsTable(env.DB);
  const prefix = '/api/items';
  const suffix = url.pathname.slice(prefix.length);
  const id = suffix.startsWith('/') ? decodeURIComponent(suffix.slice(1)).trim().toUpperCase() : '';

  if (request.method === 'POST' && suffix === '/reconcile-import') {
    return await reconcileImportApi(request, env);
  }

  if (request.method === 'POST' && suffix === '/import') {
    let payload;
    try { payload = await request.json(); }
    catch { return error('JSON de importación no válido', 400); }

    if (!payload || !Array.isArray(payload.items) || payload.items.length === 0) {
      return error('La importación no contiene elementos', 400);
    }
    if (payload.items.length > 1000) return error('Demasiados elementos en una sola importación', 400);

    let incoming;
    try {
      incoming = payload.items.map(raw => ({
        item: normalizeItem(raw),
presence: importPresence(raw)
      }));
    } catch (e) { return error(e.message, 400); }

    // v2.21.3: Ubicación/BOX, Editorial/Discográfica y Notas pueden distinguir
    // ejemplares. Solo bloqueamos filas que sigan siendo indistinguibles con todos
    // los discriminadores que realmente aporta el Excel.
    const incomingKeys = incoming.map(({ item, presence }) => presence.ulid ? `id:${item.id}` : incomingMatchKeyForItem(item, presence));
    if (new Set(incomingKeys).size !== incomingKeys.length) {
      return error('El Excel contiene filas indistinguibles. Revisa Ubicación/BOX, Editorial/Discográfica o Notas.', 409);
    }

    const { results: existingRows } = await env.DB.prepare(`
      SELECT id, legacy_key, created_at, updated_at, images_json, publisher, isbn, location, notes, more_info,
             author_given_name, author_surname_1, author_surname_2, author_sort,
             title, type, subcategory, author, format, genre, year
      FROM items
    `).all();

    const existingByBaseKey = new Map();
    const existingById = new Map();
    for (const row of existingRows || []) {
      existingById.set(String(row.id || '').toUpperCase(), row);
      const baseKey = baseMatchKeyForItem(row);
      if (!existingByBaseKey.has(baseKey)) existingByBaseKey.set(baseKey, []);
      existingByBaseKey.get(baseKey).push(row);
    }

    const now = new Date().toISOString();
    let added = 0;
    let updated = 0;
    const statements = [];

    for (const { item, presence } of incoming) {
      const baseKey = baseMatchKeyForItem(item);
      let existing = null;
      if (presence.ulid) {
        existing = existingById.get(String(item.id || '').toUpperCase()) || null;
        if (!existing) return error(`El ULID ${item.id} de “${item.title}” no existe en D1. Por seguridad no se añadirá como nuevo.`, 409);
      } else {
        let candidates = [...(existingByBaseKey.get(baseKey) || [])];
        if (presence.location) candidates = candidates.filter(row => normalizeMatchText(row.location) === normalizeMatchText(item.location));
        if (presence.publisher) candidates = candidates.filter(row => normalizeMatchText(row.publisher) === normalizeMatchText(item.publisher));
        if (presence.notes) candidates = candidates.filter(row => normalizeMatchText(row.notes) === normalizeMatchText(item.notes));
        if (candidates.length > 1) return error(`Hay varios ejemplares indistinguibles de “${item.title}”. Completa Ubicación/BOX, Editorial/Discográfica o Notas para diferenciarlos.`, 409);
        existing = candidates[0] || null;
      }

      if (existing) {
        updated++;
        const publisher = presence.publisher ? item.publisher : String(existing.publisher || '');
        const isbn = presence.isbn ? item.isbn : String(existing.isbn || '');
        const location = presence.location ? item.location : String(existing.location || '');
        const notes = presence.notes ? item.notes : String(existing.notes || '');
        const moreInfo = presence.moreInfo ? item.moreInfo : String(existing.more_info || '');
        const authorGivenName = presence.authorGivenName ? item.authorGivenName : String(existing.author_given_name || '');
        const authorSurname1 = presence.authorSurname1 ? item.authorSurname1 : String(existing.author_surname_1 || '');
        const authorSurname2 = presence.authorSurname2 ? item.authorSurname2 : String(existing.author_surname_2 || '');
        const authorSort = presence.authorSort ? item.authorSort : String(existing.author_sort || '');
        const finalLegacyKey = locationMatchKeyForItem({ ...item, location, publisher, notes });
        // Excel nunca contiene las imágenes R2: conservar siempre images_json al actualizar.
        const imagesJson = String(existing.images_json || '[]');
        statements.push(env.DB.prepare(`
          UPDATE items SET
            schema_version=?, legacy_id=?, legacy_key=?, title=?, type=?, subcategory=?,
            author=?, format=?, genre=?, year=?, notes=?, more_info=?, publisher=?, isbn=?, location=?,
            author_given_name=?, author_surname_1=?, author_surname_2=?, author_sort=?, images_json=?, updated_at=?
          WHERE id=?
        `).bind(
          item.schemaVersion, item.legacyId, finalLegacyKey, item.title, item.type,
          item.subcategory, item.author, item.format, item.genre, item.year, notes,
          moreInfo, publisher, isbn, location,
          authorGivenName, authorSurname1, authorSurname2, authorSort, imagesJson, now, existing.id
        ));
        existing.legacy_key = finalLegacyKey;
        existing.location = location;
      } else {
        added++;
        const finalLegacyKey = locationMatchKeyForItem(item);
        statements.push(env.DB.prepare(`
          INSERT INTO items (
            id, schema_version, legacy_id, legacy_key, title, type, subcategory,
            author, format, genre, year, notes, more_info, publisher, isbn, location, author_given_name, author_surname_1, author_surname_2, author_sort, images_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          item.id, item.schemaVersion, item.legacyId, finalLegacyKey, item.title, item.type,
          item.subcategory, item.author, item.format, item.genre, item.year, item.notes,
          item.moreInfo, item.publisher, item.isbn, item.location, item.authorGivenName, item.authorSurname1, item.authorSurname2, item.authorSort, JSON.stringify(item.images), now, now
        ));
        const newRow = {
          id: item.id, legacy_key: finalLegacyKey, title: item.title, type: item.type,
          subcategory: item.subcategory, author: item.author, format: item.format,
          genre: item.genre, year: item.year, publisher: item.publisher, isbn: item.isbn,
          location: item.location, notes: item.notes, author_given_name: item.authorGivenName,
          author_surname_1: item.authorSurname1, author_surname_2: item.authorSurname2,
          author_sort: item.authorSort, images_json: JSON.stringify(item.images), created_at: now
        };
        if (!existingByBaseKey.has(baseKey)) existingByBaseKey.set(baseKey, []);
        existingByBaseKey.get(baseKey).push(newRow);
      }
    }

    // Lotes moderados para mantener la importación estable también con colecciones mayores.
    for (let i = 0; i < statements.length; i += 50) {
      await env.DB.batch(statements.slice(i, i + 50));
    }
    return json({ ok: true, imported: incoming.length, added, updated });
  }

  if (request.method === 'GET' && !id) {
    const { results } = await env.DB.prepare(`
      SELECT * FROM items ORDER BY type COLLATE NOCASE, title COLLATE NOCASE, id
    `).all();
    return json({ ok: true, count: results.length, items: results.map(rowToItem) });
  }

  if (request.method === 'GET' && id) {
    if (!ULID_RE.test(id)) return error('ULID no válido', 400);
    const row = await env.DB.prepare(`SELECT * FROM items WHERE id = ?`).bind(id).first();
    if (!row) return error('Elemento no encontrado', 404);
    return json({ ok: true, item: rowToItem(row) });
  }

  if (request.method === 'POST' && !id) {
    let item;
    try { item = normalizeItem(await request.json()); }
    catch (e) { return error(e.message, 400); }
    const exists = await env.DB.prepare(`SELECT id FROM items WHERE id = ?`).bind(item.id).first();
    if (exists) return error('Ya existe un elemento con ese ULID', 409);

    const now = new Date().toISOString();
    await env.DB.prepare(`
      INSERT INTO items (
        id, schema_version, legacy_id, legacy_key, title, type, subcategory,
        author, format, genre, year, notes, more_info, publisher, isbn, location, author_given_name, author_surname_1, author_surname_2, author_sort, images_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      item.id, item.schemaVersion, item.legacyId, item.legacyKey, item.title, item.type,
      item.subcategory, item.author, item.format, item.genre, item.year, item.notes,
      item.moreInfo, item.publisher, item.isbn, item.location, item.authorGivenName, item.authorSurname1, item.authorSurname2, item.authorSort, JSON.stringify(item.images), now, now
    ).run();
    const createdRow = await env.DB.prepare(`SELECT * FROM items WHERE id = ?`).bind(item.id).first();
    return json({ ok: true, created: true, item: rowToItem(createdRow) }, 201);
  }

  if (request.method === 'PUT' && id) {
    if (!ULID_RE.test(id)) return error('ULID no válido', 400);
    let item;
    try { item = normalizeItem(await request.json()); }
    catch (e) { return error(e.message, 400); }
    if (item.id !== id) return error('El ULID de la URL y del elemento deben coincidir', 400);
    const exists = await env.DB.prepare(`SELECT created_at FROM items WHERE id = ?`).bind(id).first();
    if (!exists) return error('Elemento no encontrado', 404);
    const now = new Date().toISOString();
    await env.DB.prepare(`
      UPDATE items SET
        schema_version=?, legacy_id=?, legacy_key=?, title=?, type=?, subcategory=?,
        author=?, format=?, genre=?, year=?, notes=?, more_info=?, publisher=?, isbn=?, location=?,
        author_given_name=?, author_surname_1=?, author_surname_2=?, author_sort=?, images_json=?, updated_at=?
      WHERE id=?
    `).bind(
      item.schemaVersion, item.legacyId, item.legacyKey, item.title, item.type,
      item.subcategory, item.author, item.format, item.genre, item.year, item.notes,
      item.moreInfo, item.publisher, item.isbn, item.location, item.authorGivenName, item.authorSurname1, item.authorSurname2, item.authorSort, JSON.stringify(item.images), now, id
    ).run();
    const updatedRow = await env.DB.prepare(`SELECT * FROM items WHERE id = ?`).bind(id).first();
    return json({ ok: true, updated: true, item: rowToItem(updatedRow) });
  }

  if (request.method === 'DELETE' && id) {
    if (!ULID_RE.test(id)) return error('ULID no válido', 400);
    const exists = await env.DB.prepare(`SELECT id FROM items WHERE id = ?`).bind(id).first();
    if (!exists) return error('Elemento no encontrado', 404);
    await env.DB.prepare(`DELETE FROM items WHERE id = ?`).bind(id).run();
    let imageCleanup = true;
    if (env.IMAGES) {
      try {
        const listed = await env.IMAGES.list({ prefix: `covers/${id}/` });
        if (listed.objects.length) await env.IMAGES.delete(listed.objects.map(obj => obj.key));
      } catch (e) {
        imageCleanup = false;
        console.error('[R2 cleanup after item delete]', e);
      }
    }
    return json({ ok: true, deleted: true, id, imageCleanup });
  }

  return error('Método no permitido', 405);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      try {
        const row = await env.DB.prepare('SELECT 1 AS ok').first();
        return json({
          ok: true, app: APP, version: VERSION, backend: 'd1',
          cloudflare: true,
          d1: row?.ok === 1 ? 'connected' : 'unexpected-response',
          r2: env.IMAGES ? 'bound' : 'missing-binding'
        });
      } catch (e) {
        return json({ ok: false, app: APP, version: VERSION, backend: 'd1',
          cloudflare: true, d1: 'error', error: String(e?.message || e) }, 500);
      }
    }


    if (url.pathname === '/api/images/health' && request.method === 'GET') {
      return await r2SmokeTest(env);
    }

    if (url.pathname.startsWith('/api/images/')) {
      try { return await imageApi(request, env, url); }
      catch (e) { return error(String(e?.message || e), 500); }
    }

    if (url.pathname.startsWith('/api/restore/')) {
      try { return await restoreApi(request, env, url); }
      catch (e) { return error(String(e?.message || e), 500); }
    }

    // Los endpoints técnicos de prueba usados durante la validación inicial de D1
    // se retiraron en v2.10.4. El CRUD normal queda exclusivamente en /api/items.

    if (url.pathname === '/api/items' || url.pathname.startsWith('/api/items/')) {
      try { return await itemsApi(request, env, url); }
      catch (e) { return error(String(e?.message || e), 500); }
    }

    return env.ASSETS.fetch(request);
  }
};
