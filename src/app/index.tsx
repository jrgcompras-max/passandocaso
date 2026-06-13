import { useState } from "react";
import {
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

type StatusType = "pendente" | "visitado" | "discutido" | "evoluido";

type Paciente = {
  id: string;
  nome: string;
  leito: string;
  idade: number;
  status: StatusType;
};

const statusConfig = {
  pendente: { label: "Pendente", cor: "#FF6B6B" },
  visitado: { label: "Visitado", cor: "#FFD93D" },
  discutido: { label: "Discutido", cor: "#6BCB77" },
  evoluido: { label: "Evoluído", cor: "#4D96FF" },
};

const pacientesIniciais: Paciente[] = [
  { id: "1", nome: "Maria Silva", leito: "A1", idade: 67, status: "pendente" },
  {
    id: "2",
    nome: "João Oliveira",
    leito: "A2",
    idade: 54,
    status: "pendente",
  },
  { id: "3", nome: "Ana Costa", leito: "B1", idade: 78, status: "visitado" },
];

export default function Index() {
  const [pacientes, setPacientes] = useState<Paciente[]>(pacientesIniciais);

  const avancarStatus = (id: string) => {
    const ordem: StatusType[] = [
      "pendente",
      "visitado",
      "discutido",
      "evoluido",
    ];
    setPacientes((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        const idx = ordem.indexOf(p.status);
        return { ...p, status: ordem[Math.min(idx + 1, ordem.length - 1)] };
      }),
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.titulo}>Visita do Dia</Text>
      <Text style={styles.subtitulo}>
        {new Date().toLocaleDateString("pt-BR", {
          weekday: "long",
          day: "2-digit",
          month: "long",
        })}
      </Text>
      <FlatList
        data={pacientes}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => avancarStatus(item.id)}
          >
            <View style={styles.cardLeft}>
              <Text style={styles.leito}>Leito {item.leito}</Text>
              <Text style={styles.nome}>{item.nome}</Text>
              <Text style={styles.idade}>{item.idade} anos</Text>
            </View>
            <View
              style={[
                styles.badge,
                { backgroundColor: statusConfig[item.status].cor },
              ]}
            >
              <Text style={styles.badgeTexto}>
                {statusConfig[item.status].label}
              </Text>
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0F172A",
    paddingTop: 60,
    paddingHorizontal: 16,
  },
  titulo: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#F8FAFC",
    marginBottom: 4,
  },
  subtitulo: {
    fontSize: 14,
    color: "#94A3B8",
    marginBottom: 24,
    textTransform: "capitalize",
  },
  card: {
    backgroundColor: "#1E293B",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardLeft: { flex: 1 },
  leito: { fontSize: 12, color: "#64748B", marginBottom: 2 },
  nome: { fontSize: 16, fontWeight: "600", color: "#F8FAFC", marginBottom: 2 },
  idade: { fontSize: 13, color: "#94A3B8" },
  badge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  badgeTexto: { fontSize: 12, fontWeight: "600", color: "#0F172A" },
});
