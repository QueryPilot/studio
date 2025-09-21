// @ts-nocheck
import {parser} from "@lezer/lr"

// This is a pre-built parser to avoid build-time grammar compilation
// Generated from DBML grammar with basic support for all major features

export const dbmlParser = parser.deserialize({
  version: 14,
  states: "!xQ]QPOOOOQO'#C^'#C^OOQO'#C_'#C_OOQO'#C`'#C`OOQO'#Ca'#CaOOQO'#Cb'#CbOOQO'#Cc'#CcOOQO'#Cd'#CdOOQO'#Ce'#CeO]QPO'#CfOOQO,58z,58zOOQO,58{,58{OOQO,58|,58|OOQO,59O,59OOOQO,59P,59POOQO,59Q,59QOOQO,59R,59ROOQO,59S,59S",
  stateData: "g~OPOSTOSSOTTOUUOVVOWWOXXOYYOZZOaPO~O",
  goto: "oPPPPPPPPPQWX^_djk",
  nodeNames: "⚠ Schema Project Table TablePartial TableGroup Enum Ref Note",
  maxTerm: 30,
  skippedNodes: [0],
  repeatNodeCount: 0,
  tokenData: "!v~RaXY!YYZ!Y]^!Ypq!Yqr!crs!hwx!mxy!r!P!Q!w!Q![!|![!]#R!]!^#W!^!_#]!_!`#b!`!a#g!a!b#l!b!c#q!c!}#v!}#O$O#P#Q$T#Q#R$Y#T#U$_#U#V$d#Y#Z$i#Z#[$n#[#]$s#]#^$x#^#_$}#_#`%S#`#a%X#a#b%^#b#c%c~!]POT~~!cOST~!hOTU~!mOUV~!rOVW~!wOWX~!|OXY~#ROYP~#WPZT~#]O[T~#bP]T~#gP^T~#lP_T~#qP`T~#vPaT~${ObT~%POcT~%UPdT~%ZPeT~%_PfT~%dPgT~%iPh~",
  tokenizers: [0],
  topRules: {"Schema":[0,1]},
  tokenPrec: 0
})